import express from "express";
import { requireSecret, normalizePhone, toOntilooDateTime } from "./validators.js";
import { addCustomer, bookAppointments } from "./ontiloo.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

/**
 * POST /v1/ontiloo/appointments/create
 * Retell -> your server -> Ontiloo
 */
app.post("/v1/ontiloo/appointments/create", requireSecret, async (req, res) => {
  try {
    const { customer, group = 1, note, referenceId, items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, code: "INVALID_REQUEST", message: "Missing items" });
    }

    // --- Ensure customerId (optional but recommended) ---
    let customerId = customer?.id;

    // If no customerId, but have contact -> create customer
    if (!customerId) {
      const phone = normalizePhone(customer?.phone);
      const name = customer?.name?.trim();
      const email = customer?.email?.trim();
      const dob = customer?.dob?.trim(); // MM-dd

      // minimal requirement you decide; I enforce phone OR email OR name
      if (!phone && !email && !name) {
        return res.status(400).json({
          ok: false,
          code: "MISSING_CUSTOMER_INFO",
          message: "Need customer phone or email or name to create customer"
        });
      }

      const created = await addCustomer({ name, phone, email, dob });

      // NOTE: Swagger says AnyObject; you MUST inspect real response to pick the correct id field.
      // Common patterns: created.id, created.data.id, created.customerId...
      customerId =
        created?.id ??
        created?.data?.id ??
        created?.customerId ??
        created?.data?.customerId;

      if (!customerId) {
        return res.status(502).json({
          ok: false,
          code: "CUSTOMER_CREATE_FAILED",
          message: "Cannot get customerId from Ontiloo response",
          raw: created
        });
      }
    }

    // --- Map items to BookingItemsRq ---
    const mappedItems = items.map((it) => {
      if (!it?.serviceIds?.length) throw new Error("MISSING_SERVICE_IDS");
      const startTime = toOntilooDateTime(it.startTime); // -> MM/dd/yyyy HH:mm
      const endTime = toOntilooDateTime(it.endTime);

      const out = {
        startTime,
        endTime,
        serviceIds: it.serviceIds,
        requestStaff: !!it.requestStaff
      };

      if (it.requestStaff && it.staffId) out.staffId = it.staffId;
      return out;
    });

    const aibookRq = {
      customerId,
      group,
      items: mappedItems,
      note: note || "",
      referenceId: referenceId || "",
      sourceType: "AI"
    };

    const booked = await bookAppointments(aibookRq);

    // Same warning: response schema is AnyObject. Try extracting appointmentId.
    const appointmentId =
      booked?.appointmentId ??
      booked?.id ??
      booked?.data?.appointmentId ??
      booked?.data?.id;

    return res.json({
      ok: true,
      appointmentId: appointmentId || null,
      message: "Booked",
      raw: booked
    });
  } catch (e) {
    // Controlled error mapping
    if (e?.message === "INVALID_DATETIME_FORMAT") {
      return res.status(400).json({ ok: false, code: "INVALID_DATETIME", message: "Invalid date/time format" });
    }
    if (e?.message === "MISSING_SERVICE_IDS") {
      return res.status(400).json({ ok: false, code: "MISSING_SERVICE_IDS", message: "Missing serviceIds" });
    }

    // Ontiloo error passthrough (sanitized)
    if (e?.message === "ONTILOO_ERROR") {
      const payload = e.payload || {};
      return res.status(502).json({
        ok: false,
        code: payload.code || "ONTILOO_ERROR",
        message: payload.message || "Upstream error",
        details: payload.details || undefined
      });
    }

    return res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: "Unexpected error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`listening on ${port}`));
