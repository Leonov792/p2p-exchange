const crypto = require("crypto");
const { pool } = require("./db");

function hashCard(first6, last4) {
  const input = String(first6).replace(/\D/g, "") + String(last4).replace(/\D/g, "");
  if (input.length < 8) return null;
  return crypto.createHash("sha256").update(input).digest("hex");
}

function maskCard(first6, last4) {
  return String(first6).slice(0, 6) + "******" + String(last4).slice(-4);
}

async function bindCard(userId, first6, last4) {
  const cardHash = hashCard(first6, last4);
  if (!cardHash) throw Object.assign(new Error("Invalid card digits"), { statusCode: 400 });

  const existing = (await pool.query(
    "SELECT * FROM card_hashes WHERE user_id = $1 AND card_hash = $2", [userId, cardHash]
  )).rows[0];

  if (existing) {
    await pool.query("UPDATE card_hashes SET last_used = NOW() WHERE id = $1", [existing.id]);
    return { bound: true, existing: true };
  }

  await pool.query(
    "INSERT INTO card_hashes (user_id, card_hash, masked_card) VALUES ($1, $2, $3)",
    [userId, cardHash, maskCard(first6, last4)]
  );

  return { bound: true, masked: maskCard(first6, last4) };
}

async function verifyCardForDispute(userId, first6, last4) {
  const cardHash = hashCard(first6, last4);
  if (!cardHash) return { valid: false, reason: "Invalid format" };

  const match = (await pool.query(
    "SELECT * FROM card_hashes WHERE user_id = $1 AND card_hash = $2", [userId, cardHash]
  )).rows[0];

  if (match) {
    return { valid: true, message: "Card verified. Hash matches bound card.", cardBoundAt: match.created_at };
  }

  return { valid: false, reason: "Card not found in bound cards. Upload bank statement showing " + maskCard(first6, last4) };
}

async function getUserCards(userId) {
  const { rows } = await pool.query(
    "SELECT masked_card, last_used, created_at FROM card_hashes WHERE user_id = $1 ORDER BY last_used DESC", [userId]
  );
  return rows;
}

module.exports = { hashCard, maskCard, bindCard, verifyCardForDispute, getUserCards };
