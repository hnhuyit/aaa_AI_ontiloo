import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import customParseFormat from "dayjs/plugin/customParseFormat.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const TZ = process.env.BOOKING_TZ || "Asia/Ho_Chi_Minh";

function toLocalNow() {
  return dayjs().tz(TZ);
}

// format Ontiloo cần: MM/DD/YYYY HH:mm
function fmtOntiloo(dt) {
  return dt.tz(TZ).format("MM/DD/YYYY HH:mm");
}

/**
 * Parse time string (ngày+giờ) từ voice:
 * - ISO: 2026-02-09 18:30
 * - US: 02/09/2026 18:30
 * - VN: 09/02/2026 18:30
 * - no year: 02/09 18:30, 9/2 18:30
 * - relative: hôm nay, mai/ngày mai, mốt
 * - hour: 15h, 15:30, 3pm, 3 giờ chiều, 7 tối
 *
 * Rule: nếu không có year → lấy year hiện tại; nếu ra quá khứ → cộng 1 năm.
 * Rule: nếu chỉ nói "mai 3 chiều" → dùng ngày mai.
 */
export function parseSpokenDateTime(timeText) {
  if (!timeText || typeof timeText !== "string") {
    throw new Error("MISSING_TIME");
  }

  let t = timeText.trim().toLowerCase();

  const now = toLocalNow();

  // ---- relative day ----
  let baseDate = now.startOf("day");
  if (/(hôm nay|today)/.test(t)) baseDate = now.startOf("day");
  if (/(ngày mai|mai|tomorrow)/.test(t)) baseDate = now.add(1, "day").startOf("day");
  if (/(mốt|day after tomorrow)/.test(t)) baseDate = now.add(2, "day").startOf("day");
  if (/(tuần sau|next week)/.test(t)) baseDate = now.add(7, "day").startOf("day");

  // ---- time of day ----
  // supports: 15:30, 15h30, 15h, 3pm, 3 pm, 3 giờ chiều, 7 tối
  let hour = null;
  let minute = 0;

  // 15:30
  let m = t.match(/(\d{1,2})\s*[:]\s*(\d{2})/);
  if (m) {
    hour = Number(m[1]);
    minute = Number(m[2]);
  } else {
    // 15h30 or 15h
    m = t.match(/(\d{1,2})\s*h\s*(\d{2})?/);
    if (m) {
      hour = Number(m[1]);
      minute = m[2] ? Number(m[2]) : 0;
    } else {
      // 3pm
      m = t.match(/(\d{1,2})\s*(am|pm)/);
      if (m) {
        hour = Number(m[1]);
        minute = 0;
        if (m[2] === "pm" && hour < 12) hour += 12;
        if (m[2] === "am" && hour === 12) hour = 0;
      } else {
        // 3 giờ chiều / 7 tối / sáng
        m = t.match(/(\d{1,2})\s*(giờ)?\s*(sáng|trưa|chiều|tối)/);
        if (m) {
          hour = Number(m[1]);
          minute = 0;
          const part = m[3];
          if (part === "trưa") {
            if (hour < 11) hour = 12;
          } else if (part === "chiều" || part === "tối") {
            if (hour < 12) hour += 12;
          } else if (part === "sáng") {
            if (hour === 12) hour = 0;
          }
        }
      }
    }
  }

  // ---- explicit date detection ----
  // Accept:
  // - YYYY-MM-DD
  // - MM/DD/YYYY or DD/MM/YYYY
  // - MM/DD or DD/MM (no year)
  const dateFormats = [
    "YYYY-MM-DD",
    "YYYY/MM/DD",
    "MM/DD/YYYY",
    "DD/MM/YYYY",
    "MM-DD-YYYY",
    "DD-MM-YYYY",
    "MM/DD",
    "DD/MM",
    "MM-DD",
    "DD-MM"
  ];

  // Find date-like token
  const dateToken = (t.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/) ||
    t.match(/\d{1,2}[-/]\d{1,2}([-/]\d{4})?/))?.[0];

  let dt;

  if (dateToken) {
    // Build with dateToken + time if possible
    const timeToken =
      t.match(/\d{1,2}\s*[:]\s*\d{2}/)?.[0] ||
      t.match(/\d{1,2}\s*h\s*\d{2}/)?.[0] ||
      t.match(/\d{1,2}\s*h/)?.[0] ||
      t.match(/\d{1,2}\s*(am|pm)/)?.[0] ||
      t.match(/\d{1,2}\s*(giờ)?\s*(sáng|trưa|chiều|tối)/)?.[0];

    // Prefer parsing dateToken alone, then set hour/minute parsed above
    let parsedDate = null;
    for (const f of dateFormats) {
      const cand = dayjs.tz(dateToken, f, TZ);
      if (cand.isValid()) {
        parsedDate = cand;
        break;
      }
    }
    if (!parsedDate || !parsedDate.isValid()) throw new Error("INVALID_TIME");

    // if token has no year -> assume current year
    const hasYear = /\d{4}/.test(dateToken);
    if (!hasYear) parsedDate = parsedDate.year(now.year());

    if (hour === null) {
      // if no time provided, default 09:00
      hour = Number(process.env.DEFAULT_HOUR ?? 9);
      minute = Number(process.env.DEFAULT_MINUTE ?? 0);
    }

    dt = parsedDate.hour(hour).minute(minute).second(0);
    // if in the past -> push to next year (for no-year inputs), else push next day for relative phrases
    if (!hasYear && dt.isBefore(now)) dt = dt.add(1, "year");
  } else {
    // No explicit date token: use relative baseDate + parsed hour
    if (hour === null) {
      throw new Error("MISSING_TIME_OF_DAY");
    }
    dt = baseDate.hour(hour).minute(minute).second(0);
    if (dt.isBefore(now) && /(hôm nay|today)/.test(t)) {
      // if caller said today but time already passed -> move to tomorrow
      dt = dt.add(1, "day");
    }
  }

  return dt;
}

export function buildStartEndFromTimeText(timeText, durationMinutes) {
  const start = parseSpokenDateTime(timeText);
  const dur = Number(durationMinutes || process.env.DEFAULT_DURATION_MINUTES || 60);
  const end = start.add(dur, "minute");
  return { startTime: fmtOntiloo(start), endTime: fmtOntiloo(end) };
}
