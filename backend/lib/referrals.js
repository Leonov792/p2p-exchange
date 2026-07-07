const { pool } = require("./db");

const REFERRAL_RATE = 0.005;
const REFERRAL_BONUS_STARS = 10;

async function processReferral(newUserId, referrerId) {
  if (!referrerId || newUserId === referrerId) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const exists = (await client.query(
      "SELECT * FROM referrals WHERE referred_id = $1", [newUserId]
    )).rows[0];

    if (exists) { await client.query("COMMIT"); return null; }

    await client.query(
      "INSERT INTO referrals (referrer_id, referred_id, status) VALUES ($1, $2, 'active')",
      [referrerId, newUserId]
    );

    await client.query(
      "INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [referrerId]
    );

    await client.query(
      "UPDATE users SET referral_bonus = COALESCE(referral_bonus, 0) + $1 WHERE id = $2",
      [REFERRAL_BONUS_STARS, referrerId]
    );

    await client.query("COMMIT");
    return { success: true, bonus: REFERRAL_BONUS_STARS };
  } catch (e) {
    await client.query("ROLLBACK");
    return null;
  } finally {
    client.release();
  }
}

async function creditReferralCommission(dealId, buyerId, sellerId, amountUsdt) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const buyerReferral = (await client.query(
      "SELECT referrer_id FROM referrals WHERE referred_id = $1 AND status = 'active'", [buyerId]
    )).rows[0];

    const sellerReferral = (await client.query(
      "SELECT referrer_id FROM referrals WHERE referred_id = $1 AND status = 'active'", [sellerId]
    )).rows[0];

    if (buyerReferral) {
      const commission = parseFloat((amountUsdt * REFERRAL_RATE).toFixed(6));
      await client.query(
        "UPDATE users SET referral_earnings = COALESCE(referral_earnings, 0) + $1 WHERE id = $2",
        [commission, buyerReferral.referrer_id]
      );
      await client.query(
        "INSERT INTO referral_commissions (deal_id, referrer_id, referred_id, amount_usdt, rate) VALUES ($1,$2,$3,$4,$5)",
        [dealId, buyerReferral.referrer_id, buyerId, commission, REFERRAL_RATE]
      );
    }

    if (sellerReferral && sellerReferral.referrer_id !== buyerReferral?.referrer_id) {
      const commission = parseFloat((amountUsdt * REFERRAL_RATE).toFixed(6));
      await client.query(
        "UPDATE users SET referral_earnings = COALESCE(referral_earnings, 0) + $1 WHERE id = $2",
        [commission, sellerReferral.referrer_id]
      );
      await client.query(
        "INSERT INTO referral_commissions (deal_id, referrer_id, referred_id, amount_usdt, rate) VALUES ($1,$2,$3,$4,$5)",
        [dealId, sellerReferral.referrer_id, sellerId, commission, REFERRAL_RATE]
      );
    }

    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

async function getReferralStats(userId) {
  const { rows: refs } = await pool.query(
    "SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE status = 'active')::int as active FROM referrals WHERE referrer_id = $1",
    [userId]
  );

  const { rows: earnings } = await pool.query(
    "SELECT COALESCE(SUM(amount_usdt),0) as total FROM referral_commissions WHERE referrer_id = $1",
    [userId]
  );

  const user = (await pool.query("SELECT referral_bonus, referral_earnings FROM users WHERE id = $1", [userId])).rows[0];

  return {
    referralLink: `https://t.me/SergGOrelyyBot?start=ref${userId}`,
    referralsTotal: refs[0]?.total || 0,
    referralsActive: refs[0]?.active || 0,
    referralEarnings: parseFloat(earnings[0]?.total || "0"),
    referralBonus: user?.referral_bonus || 0,
    rate: REFERRAL_RATE * 100 + "%",
  };
}

module.exports = { processReferral, creditReferralCommission, getReferralStats, REFERRAL_RATE };
