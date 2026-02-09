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
  if (!ymdHm) return "";
  const s = String(ymdHm).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) throw new Error("INVALID_DATETIME_FORMAT");
  const [, yyyy, MM, dd, HH, mm] = m;
  return `${MM}/${dd}/${yyyy} ${HH}:${mm}`;
}
