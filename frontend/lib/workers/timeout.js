const { pool } = require("../db");

async function processTimeouts() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const timedOutCreation = await client.query(
      `UPDATE deals SET status = 'timed_out'
       WHERE status = 'created' AND payment_deadline < NOW()
       RETURNING id`
    );
    for (const d of timedOutCreation.rows) {
      await client.query(
        "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1,'created','timed_out',0)",
        [d.id]
      );
    }

    const timedOutLocked = await client.query(
      `UPDATE deals SET status = 'timed_out'
       WHERE status = 'locked' AND payment_deadline < NOW()
       RETURNING id, seller_id, amount_usdt`
    );
    for (const d of timedOutLocked.rows) {
      await client.query(
        "UPDATE users SET balance_frozen = GREATEST(balance_frozen - $1, 0) WHERE id = $2",
        [d.amount_usdt, d.seller_id]
      );
      await client.query(
        "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1,'locked','timed_out',0)",
        [d.id]
      );
    }

    const timedOutPaid = await client.query(
      `UPDATE deals SET status = 'disputed'
       WHERE status = 'paid' AND confirm_deadline < NOW()
       RETURNING id`
    );
    for (const d of timedOutPaid.rows) {
      await client.query(
        "INSERT INTO disputes (deal_id, initiator_id, reason) VALUES ($1, 0, 'Auto-disputed: seller timeout for confirmation')",
        [d.id]
      );
      await client.query(
        "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1,'paid','disputed',0)",
        [d.id]
      );
    }

    const totalAffected = timedOutCreation.rows.length + timedOutLocked.rows.length + timedOutPaid.rows.length;

    await client.query("COMMIT");
    return {
      timedOutCreated: timedOutCreation.rows.length,
      timedOutLocked: timedOutLocked.rows.length,
      autoDisputed: timedOutPaid.rows.length,
      total: totalAffected,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Timeout processor error:", e.message);
    return { error: e.message };
  } finally {
    client.release();
  }
}

if (require.main === module) {
  processTimeouts().then((r) => {
    console.log("Timeout processing result:", JSON.stringify(r));
    process.exit(0);
  });
}

module.exports = { processTimeouts };
