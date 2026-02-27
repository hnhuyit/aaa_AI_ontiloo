import express from "express";
import { requireSecret, normalizePhone, toOntilooDateTime, formatYMDHM, getNowWithOffsetMinutes, roundUpMinutes } from "./validators.js";
import { addCustomer, updateAppointmentNote, bookAppointments, deleteAppointmentById, searchServiceByName, pickServiceFromSearch, getListAppointment  } from "./ontiloo.js";
import { buildStartEndFromTimeText } from "./time.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

/**
 * POST /v1/ontiloo/appointments/create
 * Retell -> your server -> Ontiloo
 */

// const TZ_OFFSET_MINUTES=420
// const DEFAULT_LEAD_MINUTES=60
// const DEFAULT_DURATION_MINUTES=30
// const DEFAULT_ROUND_MINUTES=30

// const DEFAULT_GROUP=1656
// const DEFAULT_SERVICE_IDS=6137
// const DEFAULT_REQUEST_STAFF=true
// const DEFAULT_STAFF_ID=1643
// const DEFAULT_SOURCE_TYPE="AI"

// ===== Defaults (env override) =====
const TZ_OFFSET_MINUTES = Number(process.env.TZ_OFFSET_MINUTES ?? 420);
const DEFAULT_LEAD_MINUTES = Number(process.env.DEFAULT_LEAD_MINUTES ?? 60);
const DEFAULT_DURATION_MINUTES = Number(process.env.DEFAULT_DURATION_MINUTES ?? 30);
const DEFAULT_ROUND_MINUTES = Number(process.env.DEFAULT_ROUND_MINUTES ?? 30);

const DEFAULT_GROUP = Number(process.env.DEFAULT_GROUP ?? 1656);
const DEFAULT_SOURCE_TYPE = process.env.DEFAULT_SOURCE_TYPE ?? "AI";
// const durationMinutes = Number(process.env.DEFAULT_DURATION_MINUTES || 60);

const STAFF_POOL = (process.env.STAFF_POOL ?? "1643,1650,1656")
  .split(",")
  .map((s) => Number(String(s).trim()))
  .filter(Boolean);

const SERVICE_POOL = (process.env.SERVICE_POOL ?? "6136,6137,6138,6139,6140,6142,6143,6144,6145,6146,6147,6148,6149,6150,6151,6152")
  .split(",")
  .map((s) => Number(String(s).trim()))
  .filter(Boolean);

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];



app.post("/v1/ontiloo/appointments/create", requireSecret, async (req, res) => {
  console.log("Run /appointments/create");

  try {
    const body = (req.body && (req.body.args || req.body)) || {};
    // console.log("DEBUG body:", body);

    // ====== REQUIRED INPUT NOW: customer.name + customer.phone only ======
    const rawName = body.customer?.name;
    const rawPhone = body.customer?.phone;

    const name = typeof rawName === "string" ? rawName.trim() : "";
    const phone = normalizePhone(rawPhone);

    console.log("DEBUG incoming:", {
        keys: Object.keys(req.body || {}),
            hasArgs: !!req.body?.args,
            customerPath: req.body?.customer ? "body.customer" : (req.body?.args?.customer ? "body.args.customer" : "missing"),
            rawName,
            rawPhone,
            name,
            phone
    });

    if (!name || !phone) {
      return res.status(400).json({
          ok: false,
          code: "MISSING_CUSTOMER_INFO",
          message: "Customer name and phone are required"
      });
    }


    // create/find customerId (giữ nguyên logic của bạn)
    let customerId = body.customerId ?? body.customer?.id;
    if (!customerId) {
      const created = await addCustomer({ name, phone });
      customerId = created?.id ?? created?.data?.id ?? created?.customerId ?? created?.data?.customerId;
      if (!customerId) return res.status(502).json({ ok: false, code: "CUSTOMER_CREATE_FAILED", message: "Cannot get customerId" });
    }

    // pick staff/service
    // const serviceId = pickRandom(SERVICE_POOL);
    const staffId = pickRandom(STAFF_POOL);

    // 1) chọn serviceName (caller đưa hoặc default)
    const serviceName = typeof body.serviceName === "string" ? body.serviceName.trim() : "NAILS REFILL";

    // 2) gọi API lấy service + duration
    const serviceSearch = await searchServiceByName(serviceName);
    const picked = pickServiceFromSearch(serviceSearch);

    if (!picked?.serviceId || !picked?.durationMinutes) {
      return res.status(400).json({
        ok: false,
        code: "SERVICE_NOT_FOUND",
        message: "Service not found or missing duration"
      });
    }

    const serviceId = picked.serviceId;
    const durationMinutes = picked.durationMinutes;

    // timeText is REQUIRED now
    const timeText = typeof body.time === "string" ? body.time.trim() : "";
    if (!timeText) {
      return res.status(400).json({ ok: false, code: "MISSING_TIME", message: "time is required" });
    }
    const { startTime, endTime } = buildStartEndFromTimeText(timeText, durationMinutes);
    
    console.log("Time ", startTime, endTime)
    // temp reference
    const tempRef = `AI-${Date.now()}`;

    const aibookRq = {
      customerId: Number(customerId),
      group: Number(body.group ?? DEFAULT_GROUP),
      items: [
        {
          startTime, // MM/DD/YYYY HH:mm
          endTime,
          requestStaff: true,
          serviceIds: [serviceId],
          staffId
        }
      ],
      note: tempRef,
      referenceId: tempRef,
      sourceType: "AI"
    };
    console.log("aibookRq", aibookRq)

    const booked = await bookAppointments(aibookRq);

    const appointmentId =
      booked?.appointmentId ??
      booked?.id ??
      booked?.data?.appointmentId ??
      booked?.data?.id ??
      null;
      
    console.log("booked", booked, appointmentId)

    // if (appointmentId) {
    //     try {
    //         await updateAppointmentNote(appointmentId, appointmentId);
    //     } catch (err) {
    //         // không fail booking nếu update note lỗi
    //         console.warn("Update appointment note failed", {
    //         appointmentId,
    //         err: err?.message
    //         });
    //     }
    // }

    return res.json({
      ok: true,
      appointmentId,
      message: "Booked successfully",
      chosen: { timeText, startTime, endTime, serviceId, staffId },
      raw: booked
    });
  } catch (e) {
    
    if (e?.message === "MISSING_TIME_OF_DAY") {
      return res.status(400).json({ ok: false, code: "MISSING_TIME_OF_DAY", message: "Please provide a time (hour) for the appointment" });
    }
    if (e?.message === "INVALID_TIME") {
      return res.status(400).json({ ok: false, code: "INVALID_TIME", message: "Time format not recognized" });
    }
    if (e?.message === "ONTILOO_ERROR") {
      const payload = e.payload || {};
      return res.status(502).json({ ok: false, code: payload.code || "ONTILOO_ERROR", message: payload.message || "Upstream error" });
    }

    console.error(e);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: "Unexpected error" });
  }
});

app.post("/v1/ontiloo/appointments/cancel", requireSecret, async (req, res) => {
    console.log("Run /appointments/cancel");
  try {
    const body = (req.body && (req.body.args || req.body)) || {};
    const appointmentId = body.appointmentId ?? body.id;

    if (!appointmentId) {
      return res.status(400).json({
        ok: false,
        code: "MISSING_APPOINTMENT_ID",
        message: "appointmentId is required"
      });
    }

    // Chọn 1 trong 2:
    // const raw = await cancelAppointmentOpenApi(Number(appointmentId));
    const raw = await deleteAppointmentById(Number(appointmentId));

    return res.json({ ok: true, appointmentId: Number(appointmentId), message: "Cancelled", raw });
  } catch (e) {
    if (e?.message === "MISSING_APPOINTMENT_ID") {
      return res.status(400).json({ ok: false, code: "MISSING_APPOINTMENT_ID", message: "appointmentId is required" });
    }
    if (e?.message === "ONTILOO_ERROR") {
      const payload = e.payload || {};
      return res.status(502).json({
        ok: false,
        code: payload.code || "ONTILOO_ERROR",
        message: payload.message || "Upstream error",
        details: payload.details || undefined
      });
    }
    console.error(e);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: "Unexpected error" });
  }
});


app.post("/v1/ontiloo/appointments/list", requireSecret, async (req, res) => {
  try {
    const body = (req.body && (req.body.args || req.body)) || {};
    const startDate = typeof body.startDate === "string" ? body.startDate.trim() : "";
    const endDate = typeof body.endDate === "string" ? body.endDate.trim() : "";

    if (!startDate || !endDate) {
      return res.status(400).json({
        ok: false,
        code: "MISSING_DATE_RANGE",
        message: "startDate and endDate are required (MM-dd-yyyy)"
      });
    }

    const raw = await getListAppointment({ startDate, endDate });
    return res.json({ ok: true, startDate, endDate, raw });
  } catch (e) {
    if (e?.message === "ONTILOO_ERROR") {
      const payload = e.payload || {};
      return res.status(502).json({
        ok: false,
        code: payload.code || "ONTILOO_ERROR",
        message: payload.message || "Upstream error",
        details: payload.details || undefined
      });
    }
    console.error(e);
    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: "Unexpected error" });
  }
});

async function testListAppointment() {
  try {
    const raw = await getListAppointment({
      startDate: "02-22-2026",
      endDate: "02-22-2026"
    });

    console.log("testListAppointment:", raw);
  } catch (e) {
    console.error("testListAppointment ERROR:", e?.message);
    console.error(e?.payload);
  }
}









































// -------------------------------------------------------------------------------------------------------------------
const SERVICE_LIST = [
  { id: "cut_hair", duration: 30 },
  { id: "wash_hair", duration: 30 },
  { id: "spa", duration: 60 }
];
function getRandomService() {
  return SERVICE_LIST[Math.floor(Math.random() * SERVICE_LIST.length)];
}

function addMinutes(isoTime, minutes) {
  const d = new Date(isoTime);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}
function addMinutesKeepTZ(isoTime, minutes) {
  const d = new Date(isoTime);
  d.setMinutes(d.getMinutes() + minutes);

  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d - tzOffset).toISOString().slice(0, -1);
}
function addMinutesLocal(isoTime, minutes) {
  const d = new Date(isoTime);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().replace("Z", "+07:00");
}

const STAFF_LIST = [
  "staff_1",
  "staff_2",
  "staff_3"
];

function getRandomStaff() {
  return STAFF_LIST[Math.floor(Math.random() * STAFF_LIST.length)];
}

function normalizePhoneAirtable(phone = "") {
  return phone.replace(/\D/g, "");
}

function normalizeName(name = "") {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "");
}

function buildCustomerId(name, phone) {
  return `${normalizeName(name)}_${normalizePhoneAirtable(phone)}`;
}

function parseTimeToISO(input) {
  const text = input.toLowerCase().trim();
  const now = new Date();

  let date = new Date(now);

  // ==== 1. Xác định ngày ====
  if (/mai|tomorrow/.test(text)) {
    date.setDate(date.getDate() + 1);
  } else if (/mốt|ngày kia/.test(text)) {
    date.setDate(date.getDate() + 2);
  } else {
    // dd/mm hh:mm
    const dm = text.match(/(\d{1,2})\/(\d{1,2})/);
    if (dm) {
      const d = parseInt(dm[1]);
      const m = parseInt(dm[2]) - 1;
      date.setMonth(m);
      date.setDate(d);
    }
  }

  // ==== 2. Xác định giờ ====
  let hour = 9;
  let minute = 0;

  const hm = text.match(/(\d{1,2})(?:h|:| giờ)?\s*(\d{1,2})?/);
  if (hm) {
    hour = parseInt(hm[1]);
    if (hm[2]) minute = parseInt(hm[2]);
  }

  // ==== 3. Điều chỉnh sáng / chiều / tối ====
  if (/chiều|pm/.test(text) && hour < 12) hour += 12;
  if (/tối/.test(text) && hour < 12) hour += 12;
  if (/sáng|am/.test(text) && hour === 12) hour = 0;

  date.setHours(hour, minute, 0, 0);

  // ==== 4. Convert ISO +07 ====
  const tzOffset = date.getTimezoneOffset() * 60000;
  const localISO = new Date(date - tzOffset).toISOString().slice(0, -1);

  return localISO;
}

/* =======================
   ENV
======================= */
// const port = process.env.PORT || 3000;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "app76taan1CLN4k7z";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || "";
const AIRTABLE_TABLE_APPOINTMENTS = process.env.AIRTABLE_TABLE_APPOINTMENTS || "pos";


/* =======================
   Airtable Request
======================= */
async function airtableRequest(path, { method = "GET", body } = {}) {
  if (!AIRTABLE_BASE_ID) throw new Error("MISSING_AIRTABLE_BASE_ID");
  if (!AIRTABLE_TOKEN) throw new Error("MISSING_AIRTABLE_TOKEN");

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error("AIRTABLE_ERROR");
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}


/* =======================
   Booking Rule: Overlap
======================= */
function buildConflictFilter({ staffRecordId, startISO, endISO }) {
  return `
AND(
  {staffId} = "${staffRecordId}",
  OR({status}="PENDING", {status}="CONFIRMED"),
  {start_time} < DATETIME_PARSE("${endISO}"),
  {end_time} > DATETIME_PARSE("${startISO}")
)
`.trim();
}
/* =======================
   Check Availability
======================= */
async function checkAvailability({ staffRecordId, startISO, endISO }) {
  const filterByFormula = buildConflictFilter({
    staffRecordId,
    startISO,
    endISO
  });

  const qs = new URLSearchParams({
    filterByFormula,
    maxRecords: "10"
  });

  const data = await airtableRequest(
    `/${encodeURIComponent(AIRTABLE_TABLE_APPOINTMENTS)}?${qs.toString()}`
  );

  const conflicts = data.records || [];

  return {
    available: conflicts.length === 0,
    conflicts: conflicts.map(r => ({ id: r.id, ...r.fields }))
  };
}

/* =======================
   Create Appointment
======================= */
async function createAppointment(payload) {
  const {
    name,
    phone,
    start_time,
    note,
  } = payload;

  if (!name || !phone || !start_time) {
    const e = new Error("MISSING_REQUIRED_FIELDS");
    e.status = 400;
    throw e;
  }

  // 1) random service
  const service = getRandomService();

  // 2) tính end_time theo duration
  const end_time = addMinutesLocal(start_time, service.duration);


  // 2) capacity check (3 staff => 3 concurrent bookings)
  const cap = await checkSlotCapacity({
    startISO: start_time,
    endISO: end_time,
    capacity: 3
  });

  if (!cap.available) {
    const e = new Error("TIME_SLOT_FULL");
    e.status = 409; // để agent hiểu không available
    e.meta = cap;
    throw e;
  }

  // 3) tìm staff available
  // const staffId = await findAvailableStaff(start_time, end_time);
  const staffId = getRandomStaff();
  if (!staffId) {
    const e = new Error("NO_STAFF_AVAILABLE");
    e.status = 409;
    throw e;
  }

  // 4) build customerId
  const customerId = buildCustomerId(name, phone);

  // 5) create record
  const record = await airtableRequest(
    `/${encodeURIComponent(AIRTABLE_TABLE_APPOINTMENTS)}`,
    {
      method: "POST",
      body: {
        records: [
          {
            fields: {
              staffId,
              customerId,
              services: service.id,
              start_time,
              end_time,
              note: note || "",
              status: "PENDING",
            }
          }
        ]
      }
    }
  );

  return record.records?.[0];
}

/* =======================
   ROUTES
======================= */

// Check slot
app.get("/v1/airtable/availability", async (req, res) => {
  try {
    const { staffId, start, end } = req.query;

    const data = await checkAvailability({
      staffRecordId: staffId,
      startISO: start,
      endISO: end
    });

    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({
      ok: false,
      error: e.message,
      detail: e.data || null
    });
  }
});

function buildSlotCountFilter({ startISO, endISO }) {
  return `
AND(
  {start_time} < DATETIME_PARSE("${endISO}"),
  {end_time} > DATETIME_PARSE("${startISO}")
)
`.trim();
}

async function checkSlotCapacity({ startISO, endISO, capacity = 3 }) {
  const filterByFormula = buildSlotCountFilter({ startISO, endISO });

  const qs = new URLSearchParams({
    filterByFormula,
    // chỉ cần biết >= capacity, lấy tối đa capacity record là đủ
    maxRecords: String(capacity)
  });

  const data = await airtableRequest(
    `/${encodeURIComponent(AIRTABLE_TABLE_APPOINTMENTS)}?${qs.toString()}`
  );

  const used = (data.records || []).length;

  return {
    available: used < capacity,
    used,
    capacity
  };
}

function addMinutesISO(iso, minutes) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("INVALID_TIME");
  d.setMinutes(d.getMinutes() + minutes);
  // Airtable nhận tốt dạng ISO có Z; nếu bạn muốn +07:00 thì dùng hàm offset bạn đang dùng
  return d.toISOString();
}

// Create booking
app.post("/v1/airtable/appointments", async (req, res) => {
  try {
    const payload = req.body?.args || req.body;   // ✅ FIX
    const { time, note, referenceId, idempotencyKey, customer } = payload;

    if (!time || !customer?.name || !customer?.phone) {
      return res.status(400).json({ ok: false, error: "MISSING_REQUIRED_FIELDS" });
    }

    const start_time = parseTimeToISO(time);

    const record = await createAppointment({
      name: customer.name,
      phone: customer.phone,
      start_time,
      note: note || "",
    });

    return res.json({ ok: true, appointment: record });
  } catch (e) {
    return res.status(e.status || 500).json({
      ok: false,
      error: e.message,
      detail: e.data || null
    });
  }
});


const port = process.env.PORT || 3000;
// app.listen(port, () => console.log(`listening on ${port}`));

app.listen(port, async () => {
  console.log(`listening on ${port}`);

  // chạy test
  // await testListAppointment();
});
