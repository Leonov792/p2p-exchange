const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN || "8650667280:AAE7NbQYdXbZg8SmY3WTv_rPXL4WCJ9YEWY";
const TTL_SECONDS = 86400;

function validateInitData(initData) {
  if (!initData || typeof initData !== "string") {
    return { valid: false, error: "initData missing or invalid type" };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { valid: false, error: "hash missing" };

  params.delete("hash");

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) return { valid: false, error: "auth_date missing" };

  const authDate = parseInt(authDateRaw, 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > TTL_SECONDS) {
    return { valid: false, error: "auth_date expired", code: "EXPIRED" };
  }
  if (authDate > now + 60) {
    return { valid: false, error: "auth_date in future", code: "FUTURE" };
  }

  const sorted = Array.from(params.entries())
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b));

  const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  if (computedHash !== hash) {
    return { valid: false, error: "hash mismatch", code: "INVALID_HASH" };
  }

  const userStr = params.get("user");
  let user = null;
  if (userStr) {
    try { user = JSON.parse(userStr); } catch {}
  }

  return {
    valid: true,
    user: user || { id: parseInt(params.get("id") || "0", 10) },
    authDate,
  };
}

function verifyOrReject(initData) {
  const result = validateInitData(initData);
  if (!result.valid) {
    const err = new Error(result.error);
    err.statusCode = result.code === "EXPIRED" ? 401 : 401;
    err.code = result.code || "UNAUTHORIZED";
    throw err;
  }
  return result;
}

module.exports = { validateInitData, verifyOrReject, BOT_TOKEN };
