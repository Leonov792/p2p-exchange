const { pool } = require("./db");

const MAKER_BOND_AMOUNT = 500;
const BOND_FREEZE_DAYS = 30;
const GUARANTOR = "UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp";

async function lockBond(userId, amount) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const existing = (await client.query(
      "SELECT * FROM maker_bonds WHERE user_id = $1 AND status = 'active' FOR UPDATE", [userId]
    )).rows[0];

    if (existing) throw Object.assign(new Error("Bond already active"), { statusCode: 409 });

    const bond = (await client.query(
      `INSERT INTO maker_bonds (user_id, amount, status, locked_until)
       VALUES ($1, $2, 'active', NOW() + INTERVAL '30 days') RETURNING *`,
      [userId, amount || MAKER_BOND_AMOUNT]
    )).rows[0];

    await client.query("UPDATE users SET is_maker = TRUE WHERE id = $1", [userId]);
    await client.query("COMMIT");
    return bond;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function unlockBond(userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const bond = (await client.query(
      "SELECT * FROM maker_bonds WHERE user_id = $1 AND status = 'active' FOR UPDATE", [userId]
    )).rows[0];

    if (!bond) throw Object.assign(new Error("No active bond"), { statusCode: 404 });
    if (new Date(bond.locked_until) > new Date()) {
      throw Object.assign(new Error("Bond locked until " + bond.locked_until), { statusCode: 400 });
    }

    await client.query("UPDATE maker_bonds SET status = 'released', released_at = NOW() WHERE id = $1", [bond.id]);
    await client.query("UPDATE users SET is_maker = FALSE WHERE id = $1", [userId]);
    await client.query("COMMIT");
    return { released: true, amount: bond.amount };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function confiscateBond(makerId, victimId, dealId, reason) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const bond = (await client.query(
      "SELECT * FROM maker_bonds WHERE user_id = $1 AND status = 'active' FOR UPDATE", [makerId]
    )).rows[0];

    if (!bond) throw Object.assign(new Error("No active bond to confiscate"), { statusCode: 404 });

    const confiscation = Math.min(bond.amount, 500);
    const remaining = bond.amount - confiscation;

    await client.query(
      "UPDATE maker_bonds SET status = CASE WHEN $1 > 0 THEN 'active' ELSE 'confiscated' END, amount = $1, confiscated_amount = COALESCE(confiscated_amount,0) + $2 WHERE id = $3",
      [remaining, confiscation, bond.id]
    );

    if (remaining <= 0) {
      await client.query("UPDATE maker_bonds SET status = 'confiscated' WHERE id = $1", [bond.id]);
      await client.query("UPDATE users SET is_maker = FALSE WHERE id = $1", [makerId]);
    }

    await client.query(
      "INSERT INTO confiscations (bond_id, maker_id, victim_id, deal_id, amount, reason) VALUES ($1,$2,$3,$4,$5,$6)",
      [bond.id, makerId, victimId, dealId, confiscation, reason]
    );

    await client.query("COMMIT");
    return { confiscated: confiscation, remaining, makerId, victimId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function getMakerStatus(userId) {
  const bond = (await pool.query(
    "SELECT * FROM maker_bonds WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1", [userId]
  )).rows[0];

  const { rows: confiscations } = await pool.query(
    "SELECT COUNT(*)::int as cnt, COALESCE(SUM(amount),0) as total FROM confiscations WHERE maker_id = $1", [userId]
  );

  return {
    isMaker: !!bond,
    bondAmount: bond?.amount || 0,
    bondSince: bond?.created_at,
    bondUntil: bond?.locked_until,
    confiscationsCount: confiscations[0]?.cnt || 0,
    confiscationsTotal: confiscations[0]?.total || 0,
    requiredBond: MAKER_BOND_AMOUNT,
    guarantorAddress: GUARANTOR,
  };
}

module.exports = { lockBond, unlockBond, confiscateBond, getMakerStatus, MAKER_BOND_AMOUNT };
