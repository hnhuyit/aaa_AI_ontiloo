export function requireSecret(req, res, next) {
  const expected = process.env.RETELL_FUNCTION_SECRET;
  if (!expected) return res.status(500).json({ ok: false, code: "MISCONFIG", message: "Server missing secret" });

  const got = req.headers["x-retell-secret"];
  if (!got || got !== expected) {
    return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "Unauthorized" });
  }
  next();
}

export function normalizePhone(input) {
  if (!input) return "";
  // keep digits only
  const digits = String(input).replace(/\D+/g, "");
  return digits;
}

/**
 * Convert "YYYY-MM-DD HH:mm" -> "MM/dd/yyyy HH:mm"
 * (Ontiloo booking requires MM/dd/yyyy HH:mm)
 */
export function toOntilooDateTime(ymdHm) {
    console.log("run toOntilooDateTime")
  if (!ymdHm) return "";
  const s = String(ymdHm).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) throw new Error("INVALID_DATETIME_FORMAT");
  const [, yyyy, MM, dd, HH, mm] = m;
  return `${MM}/${dd}/${yyyy} ${HH}:${mm}`;
}


//////////////////
export function formatYMDHM(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const MM = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}`;
}

export function getNowWithOffsetMinutes(offsetMinutes = 420) {
  // Render server thường chạy UTC, mình convert sang giờ VN bằng offset
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + offsetMinutes * 60000);
}

export function roundUpMinutes(date, roundTo = 30) {
  const ms = date.getTime();
  const roundMs = roundTo * 60 * 1000;
  return new Date(Math.ceil(ms / roundMs) * roundMs);
}
