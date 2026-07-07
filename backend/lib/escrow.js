const { pool } = require("./db");

const STATUS = {
  CREATED: "created",
  LOCKED: "locked",
  PAID: "paid",
  DISPUTED: "disputed",
  RELEASED: "released",
  CANCELLED: "cancelled",
  TIMED_OUT: "timed_out",
};

const TRANSITIONS = {
  [STATUS.CREATED]: [STATUS.LOCKED, STATUS.CANCELLED, STATUS.TIMED_OUT],
  [STATUS.LOCKED]: [STATUS.PAID, STATUS.CANCELLED, STATUS.TIMED_OUT],
  [STATUS.PAID]: [STATUS.RELEASED, STATUS.DISPUTED, STATUS.TIMED_OUT],
  [STATUS.DISPUTED]: [STATUS.RELEASED, STATUS.CANCELLED],
  [STATUS.RELEASED]: [],
  [STATUS.CANCELLED]: [],
  [STATUS.TIMED_OUT]: [],
};

const PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;
const CONFIRM_TIMEOUT_MS = 30 * 60 * 1000;
const LOCK_TIMEOUT_MS = 60 * 60 * 1000;

async function escrowCreate(offerId, buyerId, sellerId, amountUsdt, totalRub, paymentMethod) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const offer = (await client.query(
      "SELECT * FROM offers WHERE id = $1 AND status = 'active' FOR UPDATE", [offerId]
    )).rows[0];

    if (!offer) throw Object.assign(new Error("Offer not found"), { statusCode: 404 });
    if (offer.user_id === buyerId) throw Object.assign(new Error("Self-trade forbidden"), { statusCode: 400 });

    await client.query(
      "UPDATE users SET balance_frozen = balance_frozen + $1 WHERE id = $2",
      [amountUsdt, sellerId]
    );

    const deal = (await client.query(
      `INSERT INTO deals (offer_id, buyer_id, seller_id, amount_usdt, total_rub, payment_method, status, payment_deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + INTERVAL '15 minutes')
       RETURNING *`,
      [offerId, buyerId, sellerId, amountUsdt, totalRub, paymentMethod, STATUS.CREATED]
    )).rows[0];

    await client.query(
      "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1, NULL, $2, $3)",
      [deal.id, STATUS.CREATED, buyerId]
    );

    await client.query("COMMIT");
    return deal;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function escrowLock(dealId, sellerId, txHash) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const deal = (await client.query(
      "SELECT * FROM deals WHERE id = $1 AND seller_id = $2 FOR UPDATE", [dealId, sellerId]
    )).rows[0];

    if (!deal) throw Object.assign(new Error("Deal not found"), { statusCode: 404 });
    if (deal.status !== STATUS.CREATED) {
      throw Object.assign(new Error("Invalid transition from " + deal.status), { statusCode: 409 });
    }
    if (!TRANSITIONS[deal.status].includes(STATUS.LOCKED)) {
      throw Object.assign(new Error("Transition not allowed"), { statusCode: 409 });
    }

    await client.query(
      "UPDATE deals SET status = $1, escrow_tx_hash = $2, locked_at = NOW() WHERE id = $3",
      [STATUS.LOCKED, txHash || "", dealId]
    );

    await client.query(
      "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1,$2,$3,$4)",
      [dealId, deal.status, STATUS.LOCKED, sellerId]
    );

    await client.query("COMMIT");
    return { ...deal, status: STATUS.LOCKED, escrow_tx_hash: txHash };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function escrowMarkPaid(dealId, buyerId, proof) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const deal = (await client.query(
      "SELECT * FROM deals WHERE id = $1 AND buyer_id = $2 FOR UPDATE", [dealId, buyerId]
    )).rows[0];

    if (!deal) throw Object.assign(new Error("Deal not found"), { statusCode: 404 });
    if (deal.status !== STATUS.LOCKED) {
      throw Object.assign(new Error("Deal must be locked before marking paid. Current: " + deal.status), { statusCode: 409 });
    }

    await client.query(
      "UPDATE deals SET status = $1, buyer_tx_proof = $2, confirm_deadline = NOW() + INTERVAL '30 minutes' WHERE id = $3",
      [STATUS.PAID, proof || "", dealId]
    );

    await client.query(
      "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1,$2,$3,$4)",
      [dealId, deal.status, STATUS.PAID, buyerId]
    );

    await client.query("COMMIT");
    return { ...deal, status: STATUS.PAID };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function escrowRelease(dealId, sellerId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const deal = (await client.query(
      "SELECT * FROM deals WHERE id = $1 AND seller_id = $2 FOR UPDATE", [dealId, sellerId]
    )).rows[0];

    if (!deal) throw Object.assign(new Error("Deal not found"), { statusCode: 404 });
    if (deal.status !== STATUS.PAID) {
      throw Object.assign(new Error("Deal must be PAID before release. Current: " + deal.status), { statusCode: 409 });
    }

    await client.query(
      "UPDATE users SET balance_frozen = GREATEST(balance_frozen - $1, 0) WHERE id = $2",
      [deal.amount_usdt, deal.seller_id]
    );
    await client.query(
      "UPDATE users SET deals_completed = deals_completed + 1 WHERE id = $1 OR id = $2",
      [deal.buyer_id, deal.seller_id]
    );

    await client.query(
      "UPDATE deals SET status = $1, completed_at = NOW(), seller_rub_confirmed = TRUE WHERE id = $2",
      [STATUS.RELEASED, dealId]
    );

    await client.query(
      "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1,$2,$3,$4)",
      [dealId, deal.status, STATUS.RELEASED, sellerId]
    );

    await client.query("COMMIT");
    return { ...deal, status: STATUS.RELEASED };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function escrowOpenDispute(dealId, userId, reason) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const deal = (await client.query(
      "SELECT * FROM deals WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2) FOR UPDATE",
      [dealId, userId]
    )).rows[0];

    if (!deal) throw Object.assign(new Error("Deal not found"), { statusCode: 404 });
    if (![STATUS.LOCKED, STATUS.PAID].includes(deal.status)) {
      throw Object.assign(new Error("Cannot dispute in status: " + deal.status), { statusCode: 409 });
    }

    await client.query("UPDATE deals SET status = $1 WHERE id = $2", [STATUS.DISPUTED, dealId]);
    await client.query(
      "INSERT INTO disputes (deal_id, initiator_id, reason) VALUES ($1,$2,$3)",
      [dealId, userId, reason || ""]
    );
    await client.query(
      "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1,$2,$3,$4)",
      [dealId, deal.status, STATUS.DISPUTED, userId]
    );

    await client.query("COMMIT");
    return { ...deal, status: STATUS.DISPUTED };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function escrowAdminResolve(dealId, adminId, decision) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const deal = (await client.query(
      "SELECT * FROM deals WHERE id = $1 AND status = 'disputed' FOR UPDATE", [dealId]
    )).rows[0];

    if (!deal) throw Object.assign(new Error("Disputed deal not found"), { statusCode: 404 });

    const newStatus = decision === "buyer" ? STATUS.RELEASED : STATUS.CANCELLED;

    if (newStatus === STATUS.RELEASED) {
      await client.query(
        "UPDATE users SET balance_frozen = GREATEST(balance_frozen - $1, 0) WHERE id = $2",
        [deal.amount_usdt, deal.seller_id]
      );
    }

    await client.query("UPDATE deals SET status = $1, completed_at = NOW() WHERE id = $2", [newStatus, dealId]);

    await client.query(
      "UPDATE disputes SET status = $1, resolved_by = $2, resolved_at = NOW() WHERE deal_id = $3",
      [decision === "buyer" ? "resolved_buyer" : "resolved_seller", adminId, dealId]
    );

    await client.query(
      "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1,$2,$3,$4)",
      [dealId, "disputed", newStatus, adminId]
    );

    await client.query("COMMIT");
    return { ...deal, status: newStatus };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  STATUS, TRANSITIONS, PAYMENT_TIMEOUT_MS, CONFIRM_TIMEOUT_MS, LOCK_TIMEOUT_MS,
  escrowCreate, escrowLock, escrowMarkPaid, escrowRelease, escrowOpenDispute, escrowAdminResolve,
};
