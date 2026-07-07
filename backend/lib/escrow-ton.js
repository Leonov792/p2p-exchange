const { pool } = require("./db");
const { freezeBalance, unfreezeBalance, transferBalance } = require("./balance");
const { calculateCommission } = require("./ton-real");
const { creditReferralCommission } = require("./referrals");
const { buildTONTransferPayload } = require("./workers/withdraw");

const GUARANTOR = "UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp";
const TON_API = "https://toncenter.com/api/v2";
const VERIFIED_TX = new Set();

const STATUS = {
  CREATED: "created",
  LOCKED: "locked",
  PAID: "paid",
  RELEASED: "released",
  CANCELLED: "cancelled",
  DISPUTED: "disputed",
  TIMED_OUT: "timed_out",
};

async function fetchTON(path) {
  try {
    const r = await fetch(TON_API + path);
    const d = await r.json();
    return d.ok ? d.result : null;
  } catch {
    return null;
  }
}

async function getUSDTTransfers(address, sinceMinutes = 60) {
  const txs = await fetchTON("/getTransactions?address=" + address + "&limit=50&archival=true");
  if (!txs || !Array.isArray(txs)) return [];

  const cutoff = Date.now() - sinceMinutes * 60000;
  return txs
    .filter((tx) => {
      const t = parseInt(tx.utime || "0") * 1000;
      return t > cutoff && tx.in_msg && tx.in_msg.source && tx.in_msg.source !== "";
    })
    .map((tx) => ({
      hash: tx.transaction_id?.hash || tx.transaction_id?.lt || String(Date.now()),
      from: tx.in_msg.source,
      to: address,
      amount: parseInt(tx.in_msg.value || "0") / 1e9,
      comment: tx.in_msg.message || tx.in_msg.comment || "",
      time: parseInt(tx.utime || "0") * 1000,
    }));
}

function buildTransferLink(recipient, amountUsdt, dealId) {
  const tonAmount = (amountUsdt * 0.05).toFixed(4);
  const comment = "DEAL_" + (typeof dealId === "string" ? dealId.slice(0, 12) : dealId);
  return {
    recipient: recipient || GUARANTOR,
    tonAmount,
    amountUsdt: amountUsdt.toFixed(2),
    comment,
    signedUrl: "ton://transfer/" + (recipient || GUARANTOR) +
      "?amount=" + tonAmount + "&text=" + encodeURIComponent(comment),
    returnUrl: "https://p2p-exchange-sigma.vercel.app" +
      "?tx=verify&deal=" + dealId + "&comment=" + encodeURIComponent(comment),
    instructions: "1. Confirm transfer in your TON wallet. 2. Return to the app. 3. Press Lock to verify.",
  };
}

async function escrowInitiate(offerId, buyerId, sellerId, amountUsdt, totalRub, paymentMethod, sellerWallet) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const offer = (await client.query(
      "SELECT * FROM offers WHERE id = $1 AND status = 'active' FOR UPDATE", [offerId]
    )).rows[0];
    if (!offer) throw Object.assign(new Error("Offer not found"), { statusCode: 404 });

    sellerId = offer.user_id;

    await freezeBalance(client, sellerId, amountUsdt);

    const deal = (await client.query(
      `INSERT INTO deals (offer_id, buyer_id, seller_id, amount_usdt, total_rub, payment_method, status, payment_deadline)
       VALUES ($1,$2,$3,$4,$5,$6,'created', NOW() + INTERVAL '15 minutes') RETURNING *`,
      [offerId, buyerId, sellerId, amountUsdt, totalRub, paymentMethod]
    )).rows[0];

    const transfer = buildTransferLink(GUARANTOR, amountUsdt, deal.id);

    await client.query(
      "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1, NULL, 'created', $2)",
      [deal.id, buyerId]
    );

    await client.query("COMMIT");

    return {
      deal,
      transfer,
      instructions: transfer.instructions,
      guarantor: GUARANTOR,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function escrowVerifyLock(dealId, sellerAddress, comment) {
  if (VERIFIED_TX.has(dealId)) {
    return { verified: true, cached: true };
  }

  const txs = await getUSDTTransfers(GUARANTOR, 60);
  const expectedComment = comment || "DEAL_" + dealId.slice(0, 12);

  const match = txs.find((tx) => {
    if (sellerAddress && tx.from !== sellerAddress) return false;
    if (tx.comment && !tx.comment.includes(dealId.slice(0, 8)) && !tx.comment.includes(expectedComment)) return false;
    return tx.amount >= 0.01;
  });

  if (!match) {
    return { verified: false, reason: "No matching TX found. Send exactly the amount to the guarantor with comment DEAL_" + dealId.slice(0, 8) + ". Wait 30-60 seconds for block confirmation.", checked: txs.length };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const deal = (await client.query(
      "SELECT * FROM deals WHERE id = $1 AND status = 'created' FOR UPDATE", [dealId]
    )).rows[0];

    if (deal) {
      await client.query(
        "UPDATE deals SET status = 'locked', escrow_tx_hash = $1, locked_at = NOW() WHERE id = $2",
        [match.hash, dealId]
      );
      await client.query(
        "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1, 'created', 'locked', $2)",
        [dealId, deal.seller_id]
      );
    }

    await client.query("COMMIT");
    VERIFIED_TX.add(dealId);

    return {
      verified: true,
      txHash: match.hash,
      amount: match.amount,
      from: match.from,
      status: "locked",
      dealUpdated: !!deal,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    return { verified: true, txHash: match.hash, amount: match.amount, dealUpdated: false, error: e.message };
  } finally {
    client.release();
  }
}

async function escrowMarkPaid(dealId, buyerId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const deal = (await client.query(
      "SELECT * FROM deals WHERE id = $1 AND buyer_id = $2 AND status = 'locked' FOR UPDATE", [dealId, buyerId]
    )).rows[0];

    if (!deal) throw Object.assign(new Error("Deal not found or not locked"), { statusCode: 404 });

    await client.query(
      "UPDATE deals SET status = 'paid', confirm_deadline = NOW() + INTERVAL '30 minutes' WHERE id = $1", [dealId]
    );

    await client.query(
      "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1, 'locked', 'paid', $2)",
      [dealId, buyerId]
    );

    await client.query("COMMIT");
    return { ...deal, status: "paid" };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function escrowReleaseDeal(dealId, sellerId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const deal = (await client.query(
      "SELECT * FROM deals WHERE id = $1 AND seller_id = $2 AND status = 'paid' FOR UPDATE", [dealId, sellerId]
    )).rows[0];

    if (!deal) throw Object.assign(new Error("Deal not found or not paid"), { statusCode: 404 });

    const commission = calculateCommission(deal.amount_usdt);
    const buyerGets = commission.sellerGets;

    await unfreezeBalance(client, deal.seller_id, deal.amount_usdt);
    await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [deal.amount_usdt, deal.seller_id]);

    const buyerExists = (await client.query("SELECT id, ton_wallet FROM users WHERE id = $1", [deal.buyer_id])).rows[0];
    if (!buyerExists) await client.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [deal.buyer_id]);
    await client.query("UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE id = $2", [buyerGets, deal.buyer_id]);
    await client.query("UPDATE users SET deals_completed = deals_completed + 1 WHERE id = $1 OR id = $2", [deal.buyer_id, deal.seller_id]);

    await client.query(
      "INSERT INTO commissions (deal_id, amount_usdt, fee_usdt, fee_percent) VALUES ($1,$2,$3,$4)",
      [dealId, deal.amount_usdt, commission.fee, commission.percent]
    );

    await client.query(
      "UPDATE deals SET status = 'released', completed_at = NOW(), seller_rub_confirmed = TRUE WHERE id = $1", [dealId]
    );

    await client.query(
      "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1, 'paid', 'released', $2)",
      [dealId, sellerId]
    );

    await creditReferralCommission(dealId, deal.buyer_id, deal.seller_id, deal.amount_usdt);

    const buyer = (await client.query("SELECT ton_wallet FROM users WHERE id = $1", [deal.buyer_id])).rows[0];
    let buyerTransfer = null;
    if (buyer?.ton_wallet) {
      buyerTransfer = buildTransferLink(buyer.ton_wallet, buyerGets, "RELEASE_" + dealId.slice(0, 12));
      await client.query(
        "INSERT INTO withdrawals (user_id, recipient_wallet, amount, status, deal_id) VALUES ($1,$2,$3,'pending',$4)",
        [deal.buyer_id, buyer.ton_wallet, buyerGets, dealId]
      );
    }

    await client.query("COMMIT");

    return {
      ...deal,
      status: "released",
      commission: commission.fee,
      buyerReceived: buyerGets,
      buyerWithdrawal: buyerTransfer,
    };
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
      "SELECT * FROM deals WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2) FOR UPDATE", [dealId, userId]
    )).rows[0];

    if (!deal) throw Object.assign(new Error("Deal not found"), { statusCode: 404 });

    await client.query("UPDATE deals SET status = 'disputed' WHERE id = $1", [dealId]);
    await client.query("INSERT INTO disputes (deal_id, initiator_id, reason) VALUES ($1,$2,$3)", [dealId, userId, reason || ""]);
    await client.query(
      "INSERT INTO deal_log (deal_id, from_status, to_status, actor_id) VALUES ($1,$2,'disputed',$3)",
      [dealId, deal.status, userId]
    );

    await client.query("COMMIT");
    return { ...deal, status: "disputed" };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  STATUS, GUARANTOR,
  escrowInitiate,
  escrowVerifyLock,
  escrowMarkPaid,
  escrowReleaseDeal,
  escrowOpenDispute,
  buildTransferLink,
  getUSDTTransfers,
};
