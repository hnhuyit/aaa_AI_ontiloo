function buildHeaders() {
  const apiKey = process.env.ONTILOO_X_API_KEY;
  if (!apiKey) throw new Error("MISSING_ONTILOO_API_KEY");

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey
  };

  // optional
  const token = process.env.ONTILOO_AUTH_TOKEN;
  if (token) headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  return headers;
}

function baseUrl() {
  return (process.env.ONTILOO_BASE_URL || "https://api.ontiloo.com").replace(/\/+$/, "");
}

// async function ontilooFetch(path, { method = "GET", body } = {}) {
//   const url = `${baseUrl()}${path}`;
//   const res = await fetch(url, {
//     method,
//     headers: buildHeaders(),
//     body: body ? JSON.stringify(body) : undefined
//   });

//   const text = await res.text();
//   let json = null;
//   try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }

//   if (!res.ok) {
//     // Ontiloo defines ErrorResponse; bubble it up in a controlled way
//     const err = new Error("ONTILOO_ERROR");
//     err.status = res.status;
//     err.payload = json || { code: "HTTP_ERROR", message: text || `HTTP ${res.status}` };
//     throw err;
//   }

//   return json;
// }

export async function ontilooFetch(path, { method = "GET", body } = {}) {
  const base = process.env.ONTILOO_BASE_URL || "https://api.ontiloo.com";
  const url = `${base}${path}`;

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": process.env.ONTILOO_API_KEY
  };

  // optional bearer token (nếu hệ thống yêu cầu)
  if (process.env.ONTILOO_BEARER_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.ONTILOO_BEARER_TOKEN}`;
  }

  if (!headers["x-api-key"]) {
    throw new Error("MISSING_ONTILOO_API_KEY");
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

    if (!res.ok) {
      const e = new Error("ONTILOO_ERROR");
      e.payload = data;
      e.status = res.status;
      throw e;
    }

    return data;
  } catch (err) {
    // giữ nguyên pattern bạn đang dùng
    throw err;
  }
}

// POST /api/v1/open-api/customer
export async function addCustomer({ name, phone, email, dob }) {
    console.log("Run addCustomer")
  const payload = {};
  if (dob) payload.dob = dob;          // MM-dd
  if (email) payload.email = email;
  if (name) payload.name = name;
  if (phone) payload.phone = phone;

  return ontilooFetch("/api/v1/open-api/customer", { method: "POST", body: payload });
}

// POST /api/v1/open-api/appointments
export async function bookAppointments(aibookRq) {
    console.log("Run bookAppointments")
  return ontilooFetch("/api/v1/open-api/appointments", { method: "POST", body: aibookRq });
}

// DELETE /api/v1/appointment/deleteAppointment/{id}
export async function deleteAppointmentById(id) {
  console.log("Run deleteAppointmentById");
  if (!id) throw new Error("MISSING_APPOINTMENT_ID");

  return ontilooFetch(`/api/v1/appointment/deleteAppointment/${id}`, {
    method: "DELETE"
  });
}