import express from "express";
import { requireSecret, normalizePhone, toOntilooDateTime, formatYMDHM, getNowWithOffsetMinutes, roundUpMinutes } from "./validators.js";
import { addCustomer, bookAppointments } from "./ontiloo.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

/**
 * POST /v1/ontiloo/appointments/create
 * Retell -> your server -> Ontiloo
 */
// app.post("/v1/ontiloo/appointments/create", requireSecret, async (req, res) => {
//   console.log("Run /appointments/create");

//   try {
//     const body = req.body || {};
//     const items = body.items;

//     if (!Array.isArray(items) || items.length === 0) {
//       return res.status(400).json({
//         ok: false,
//         code: "INVALID_REQUEST",
//         message: "Missing items"
//       });
//     }

//     /* =========================
//        1. Resolve customerId
//     ========================== */
//     let customerId = body.customerId ?? body.customer?.id;

//     if (!customerId) {
//       const phone = normalizePhone(body.customer?.phone);
//       const name = body.customer?.name?.trim();
//       const email = body.customer?.email?.trim();
//       const dob = body.customer?.dob?.trim();

//       if (!phone && !email && !name) {
//         return res.status(400).json({
//           ok: false,
//           code: "MISSING_CUSTOMER_INFO",
//           message: "Customer name or phone is required"
//         });
//       }

//       const created = await addCustomer({ name, phone, email, dob });

//       customerId =
//         created?.id ??
//         created?.data?.id ??
//         created?.customerId ??
//         created?.data?.customerId;

//       if (!customerId) {
//         return res.status(502).json({
//           ok: false,
//           code: "CUSTOMER_CREATE_FAILED",
//           message: "Cannot resolve customerId",
//           raw: created
//         });
//       }
//     }

//     /* =========================
//        2. DEFAULT VALUES (FIXED)
//     ========================== */
//     const DEFAULT_GROUP = Number(process.env.DEFAULT_GROUP ?? 1656);
//     const DEFAULT_SERVICE_IDS = (process.env.DEFAULT_SERVICE_IDS ?? "6137")
//       .split(",")
//       .map(Number);

//     const DEFAULT_REQUEST_STAFF =
//       process.env.DEFAULT_REQUEST_STAFF === "true" ? true : true;

//     const DEFAULT_STAFF_ID = Number(process.env.DEFAULT_STAFF_ID ?? 1643);
//     const DEFAULT_SOURCE_TYPE = process.env.DEFAULT_SOURCE_TYPE ?? "AI";

//     /* =========================
//        3. Map items → Ontiloo format
//     ========================== */
//     const mappedItems = items.map((it) => {
//       const startTime = toOntilooDateTime(it.startTime);
//       const endTime = toOntilooDateTime(it.endTime);

//       const requestStaff =
//         typeof it.requestStaff === "boolean"
//           ? it.requestStaff
//           : DEFAULT_REQUEST_STAFF;

//       const serviceIds =
//         Array.isArray(it.serviceIds) && it.serviceIds.length > 0
//           ? it.serviceIds
//           : DEFAULT_SERVICE_IDS;

//       if (!serviceIds.length) {
//         return res.status(400).json({
//           ok: false,
//           code: "MISSING_SERVICE_IDS",
//           message: "serviceIds is required"
//         });
//       }

//       const out = {
//         startTime,
//         endTime,
//         requestStaff,
//         serviceIds
//       };

//       if (requestStaff) {
//         const staffId = it.staffId ?? DEFAULT_STAFF_ID;
//         if (!staffId) {
//           return res.status(400).json({
//             ok: false,
//             code: "MISSING_STAFF_ID",
//             message: "staffId is required when requestStaff=true"
//           });
//         }
//         out.staffId = staffId;
//       }

//       return out;
//     });

//     /* =========================
//        4. Final payload → Ontiloo
//     ========================== */
//     const aibookRq = {
//       customerId: Number(customerId),
//       group: Number(body.group ?? DEFAULT_GROUP),
//       items: mappedItems,
//       note: body.note ?? "",
//       referenceId: body.referenceId ?? "",
//       sourceType: body.sourceType ?? DEFAULT_SOURCE_TYPE
//     };

//     const booked = await bookAppointments(aibookRq);

//     const appointmentId =
//       booked?.appointmentId ??
//       booked?.id ??
//       booked?.data?.appointmentId ??
//       booked?.data?.id ??
//       null;

//     return res.json({
//       ok: true,
//       appointmentId,
//       message: "Booked successfully",
//       raw: booked
//     });
//   } catch (e) {
//     if (e?.message === "INVALID_DATETIME_FORMAT") {
//       return res.status(400).json({
//         ok: false,
//         code: "INVALID_DATETIME",
//         message: "Invalid date/time format"
//       });
//     }

//     if (e?.message === "ONTILOO_ERROR") {
//       const payload = e.payload || {};
//       return res.status(502).json({
//         ok: false,
//         code: payload.code || "ONTILOO_ERROR",
//         message: payload.message || "Upstream error"
//       });
//     }

//     console.error(e);
//     return res.status(500).json({
//       ok: false,
//       code: "INTERNAL_ERROR",
//       message: "Unexpected error"
//     });
//   }
// });
const TZ_OFFSET_MINUTES=420
const DEFAULT_LEAD_MINUTES=60
const DEFAULT_DURATION_MINUTES=30
const DEFAULT_ROUND_MINUTES=30

const DEFAULT_GROUP=1656
const DEFAULT_SERVICE_IDS=6137
const DEFAULT_REQUEST_STAFF=true
const DEFAULT_STAFF_ID=1643
const DEFAULT_SOURCE_TYPE="AI"

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

    // ====== DEFAULTS (set via ENV; fall back to your known working values) ======
    const DEFAULT_GROUP = Number(process.env.DEFAULT_GROUP ?? 1656);
    const DEFAULT_SERVICE_IDS = (process.env.DEFAULT_SERVICE_IDS ?? "6137")
      .split(",")
      .map(s => Number(String(s).trim()))
      .filter(Boolean);

    const DEFAULT_REQUEST_STAFF =
      process.env.DEFAULT_REQUEST_STAFF ? process.env.DEFAULT_REQUEST_STAFF === "true" : true;

    const DEFAULT_STAFF_ID = Number(process.env.DEFAULT_STAFF_ID ?? 1643);
    const DEFAULT_SOURCE_TYPE = process.env.DEFAULT_SOURCE_TYPE ?? "AI";

    // ====== DEFAULT TIME SETTINGS ======
    const TZ_OFFSET_MIN = Number(process.env.TZ_OFFSET_MINUTES ?? 420);         // VN = 420
    const LEAD_MIN = Number(process.env.DEFAULT_LEAD_MINUTES ?? 60);            // now + 60'
    const DURATION_MIN = Number(process.env.DEFAULT_DURATION_MINUTES ?? 30);    // 30'
    const ROUND_MIN = Number(process.env.DEFAULT_ROUND_MINUTES ?? 30);          // round to 30'

    // ====== Resolve customerId (create customer if needed) ======
    let customerId = body.customerId ?? body.customer?.id;

    if (!customerId) {
      const email = body.customer?.email?.trim();
      const dob = body.customer?.dob?.trim(); // MM-dd (optional)

      const created = await addCustomer({ name, phone, email, dob });

      customerId =
        created?.id ??
        created?.data?.id ??
        created?.customerId ??
        created?.data?.customerId;

      if (!customerId) {
        return res.status(502).json({
          ok: false,
          code: "CUSTOMER_CREATE_FAILED",
          message: "Cannot resolve customerId from upstream",
          raw: created
        });
      }
    }

    // ====== Build DEFAULT time if items missing ======
    let items = body.items;

    if (!Array.isArray(items) || items.length === 0) {
      // auto-generate time
      const nowLocal = getNowWithOffsetMinutes(TZ_OFFSET_MIN);
      const start = roundUpMinutes(new Date(nowLocal.getTime() + LEAD_MIN * 60000), ROUND_MIN);
      const end = new Date(start.getTime() + DURATION_MIN * 60000);

      items = [
        {
          startTime: formatYMDHM(start), // "YYYY-MM-DD HH:mm"
          endTime: formatYMDHM(end)      // "YYYY-MM-DD HH:mm"
        }
      ];
    }

    const STAFF_POOL = [1643, 1650, 1656];
    const SERVICE_POOL = [
        6136,
        6137,
        6138,
        6139,
        6140,
        6142,
        6143,
        6144,
        6145,
        6146,
        6147,
        6148,
        6149,
        6150,
        6151,
        6152
        ]
    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

    const mappedItems = items.map((it) => {
        const startTime = toOntilooDateTime(it.startTime);
        const endTime = toOntilooDateTime(it.endTime);

        const serviceIds =
            Array.isArray(it.serviceIds) && it.serviceIds.length > 0
            ? it.serviceIds
            : [pickRandom(SERVICE_POOL)];

        const requestStaff =
            typeof it.requestStaff === "boolean" ? it.requestStaff : true;

        const out = { startTime, endTime, requestStaff, serviceIds };

        if (requestStaff) {
            out.staffId = it.staffId ?? pickRandom(STAFF_POOL);
        }

        return out;
    });

    const aibookRq = {
      customerId: Number(customerId),
      group: Number(body.group ?? DEFAULT_GROUP),
      items: mappedItems,
      note: body.note ?? "",
      referenceId: body.referenceId ?? "",
      sourceType: body.sourceType ?? DEFAULT_SOURCE_TYPE
    };

    const booked = await bookAppointments(aibookRq);

    const appointmentId =
      booked?.appointmentId ??
      booked?.id ??
      booked?.data?.appointmentId ??
      booked?.data?.id ??
      null;

    return res.json({
      ok: true,
      appointmentId,
      message: "Booked successfully",
      raw: booked
    });
  } catch (e) {
    if (e?.message === "INVALID_DATETIME_FORMAT") {
      return res.status(400).json({ ok: false, code: "INVALID_DATETIME", message: "Invalid date/time format" });
    }
    if (e?.message === "MISSING_SERVICE_IDS") {
      return res.status(400).json({ ok: false, code: "MISSING_SERVICE_IDS", message: "Missing default serviceIds" });
    }
    if (e?.message === "MISSING_STAFF_ID") {
      return res.status(400).json({ ok: false, code: "MISSING_STAFF_ID", message: "Missing default staffId" });
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
