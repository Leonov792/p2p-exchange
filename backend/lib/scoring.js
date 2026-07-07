const { pool } = require("./db");

async function computeTrustScore(userId, tgAccountAgeDays, hasUsername, hasPremium) {
  let score = 0;
  const reasons = [];

  if (tgAccountAgeDays >= 365) { score += 30; reasons.push("TG account 1+ year"); }
  else if (tgAccountAgeDays >= 90) { score += 15; reasons.push("TG account 3+ months"); }
  else if (tgAccountAgeDays < 7) { reasons.push("TG account < 7 days"); }
  else { score += 5; }

  if (hasUsername) { score += 10; reasons.push("Has username"); }
  else { reasons.push("No username"); }

  if (hasPremium) { score += 10; reasons.push("TG Premium"); }

  const { rows: deals } = await pool.query(
    "SELECT COUNT(*)::int as cnt FROM deals WHERE (buyer_id=$1 OR seller_id=$1) AND status='released' AND completed_at >= NOW() - INTERVAL '90 days'",
    [userId]
  );
  const dealCount = deals[0]?.cnt || 0;
  if (dealCount >= 50) { score += 40; reasons.push("50+ deals (Verified Trader)"); }
  else if (dealCount >= 10) { score += 20; reasons.push("10+ deals"); }
  else if (dealCount > 0) { score += 5; reasons.push("1+ deal"); }

  const { rows: disp } = await pool.query(
    "SELECT COUNT(*)::int as cnt FROM disputes WHERE initiator_id=$1 AND status != 'resolved_buyer' AND status != 'resolved_seller'", [userId]
  );
  const lostDisputes = disp[0]?.cnt || 0;
  if (lostDisputes > 0) { score -= lostDisputes * 15; reasons.push(lostDisputes + " lost disputes"); }

  score = Math.max(0, Math.min(100, score));

  await pool.query("UPDATE users SET trust_score = $1 WHERE id = $2", [score, userId]);

  const limits = getLimits(score, dealCount, tgAccountAgeDays);

  return { score, reasons, limits, dealCount, tgAccountAgeDays };
}

function getLimits(score, dealCount, accountAgeDays) {
  if (accountAgeDays < 7 && !dealCount) {
    return { maxDealUsdt: 10, maxDailyVolume: 10, quarantine: true, quarantineReason: "New account (< 7 days)" };
  }
  if (dealCount < 10) {
    return { maxDealUsdt: 100, maxDailyVolume: 500, quarantine: true, quarantineReason: "Less than 10 deals" };
  }
  if (score >= 80) {
    return { maxDealUsdt: 100000, maxDailyVolume: 500000, quarantine: false, level: "Verified Trader" };
  }
  if (score >= 50) {
    return { maxDealUsdt: 10000, maxDailyVolume: 50000, quarantine: false, level: "Trusted" };
  }
  return { maxDealUsdt: 1000, maxDailyVolume: 5000, quarantine: false, level: "Standard" };
}

async function checkDealLimits(userId, amountUsdt) {
  const user = (await pool.query("SELECT trust_score, deals_completed FROM users WHERE id = $1", [userId])).rows[0];
  if (!user) return { allowed: false, reason: "User not found" };

  const score = user.trust_score || 0;
  const limits = getLimits(score, user.deals_completed || 0, 365);

  if (amountUsdt > limits.maxDealUsdt) {
    return { allowed: false, reason: `Max deal ${limits.maxDealUsdt} USDT. Your limit: ${limits.maxDealUsdt}`, limits };
  }

  const today = new Date().toISOString().split("T")[0];
  const { rows: vol } = await pool.query(
    "SELECT COALESCE(SUM(amount_usdt),0) as v FROM deals WHERE (buyer_id=$1 OR seller_id=$1) AND created_at::date = $2 AND status IN ('released','locked','paid','disputed')",
    [userId, today]
  );
  const todayVolume = parseFloat(vol[0]?.v || "0");
  if (todayVolume + amountUsdt > limits.maxDailyVolume) {
    return { allowed: false, reason: `Daily limit ${limits.maxDailyVolume} USDT. Used: ${todayVolume}`, limits };
  }

  return { allowed: true, limits };
}

module.exports = { computeTrustScore, checkDealLimits, getLimits };
