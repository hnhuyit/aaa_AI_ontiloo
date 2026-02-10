import express from "express";
import { requireSecret, normalizePhone, toOntilooDateTime, formatYMDHM, getNowWithOffsetMinutes, roundUpMinutes } from "./validators.js";
import { addCustomer, updateAppointmentNote, bookAppointments, deleteAppointmentById } from "./ontiloo.js";
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
const durationMinutes = Number(process.env.DEFAULT_DURATION_MINUTES || 60);

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
    const serviceId = pickRandom(SERVICE_POOL);
    const staffId = pickRandom(STAFF_POOL);

    // timeText is REQUIRED now
    const timeText = typeof body.time === "string" ? body.time.trim() : "";
    if (!timeText) {
      return res.status(400).json({ ok: false, code: "MISSING_TIME", message: "time is required" });
    }
    const { startTime, endTime } = buildStartEndFromTimeText(timeText, durationMinutes);
    
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

    // const appointmentId =
    //   booked?.appointmentId ??
    //   booked?.id ??
    //   booked?.data?.appointmentId ??
    //   booked?.data?.id ??
    //   null;
      
    // console.log("booked", booked, appointmentId)

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


const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`listening on ${port}`));
