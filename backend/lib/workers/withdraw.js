const { pool } = require("./db");
const { GUARANTOR } = require("./ton-real");

async function processWithdrawals() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const pending = await client.query(
      `SELECT w.*, u.ton_wallet as user_wallet 
       FROM withdrawals w JOIN users u ON w.user_id = u.id 
       WHERE w.status = 'pending' 
       ORDER BY w.created_at ASC 
       LIMIT 10 FOR UPDATE`
    );

    let processed = 0;
    for (const w of pending.rows) {
      const recipient = w.user_wallet || w.recipient_wallet;
      if (!recipient || !recipient.startsWith('UQ')) continue;

      const txPayload = buildTONTransferPayload(recipient, w.amount, w.id);

      await client.query(
        "UPDATE withdrawals SET status = 'processing', recipient_wallet = $1 WHERE id = $2",
        [recipient, w.id]
      );

      console.log(`[Withdraw] #${w.id}: ${w.amount} USDT → ${recipient.slice(0, 12)}...`);
      console.log(`[Withdraw] Deep-link: ${txPayload.signedUrl}`);

      processed++;
    }

    await client.query("COMMIT");
    return { processed, pending: pending.rows };
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Withdraw worker error:", e.message);
    return { error: e.message };
  } finally {
    client.release();
  }
}

async function autoReleaseAfterDeal(dealId, buyerUsdtAmount, buyerWallet) {
  if (!buyerWallet || !buyerWallet.startsWith('UQ')) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = (await client.query(
      "SELECT * FROM withdrawals WHERE deal_id = $1", [dealId]
    )).rows[0];
    if (existing) { await client.query("COMMIT"); return existing; }

    const w = (await client.query(
      "INSERT INTO withdrawals (user_id, recipient_wallet, amount, status, deal_id) VALUES ($1,$2,$3,'pending',$4) RETURNING *",
      [null, buyerWallet, buyerUsdtAmount, dealId]
    )).rows[0];

    await client.query("COMMIT");

    const txPayload = buildTONTransferPayload(buyerWallet, buyerUsdtAmount, dealId);
    console.log(`[Auto-Release] Deal #${dealId}: ${buyerUsdtAmount} USDT → ${buyerWallet.slice(0, 12)}...`);
    console.log(`[Auto-Release] Deep-link: ${txPayload.signedUrl}`);

    return { withdrawal: w, ...txPayload };
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Auto-release error:", e.message);
    return null;
  } finally {
    client.release();
  }
}

function buildTONTransferPayload(recipient, amountUsdt, dealId) {
  const tonAmount = (amountUsdt * 0.05).toFixed(4);
  const comment = "P2P_WITHDRAW_" + (typeof dealId === 'string' ? dealId.slice(0, 8) : dealId);

  return {
    recipient,
    amount: amountUsdt.toFixed(2),
    tonAmount,
    comment,
    signedUrl: `ton://transfer/${recipient}?amount=${tonAmount}&text=${encodeURIComponent(comment)}`,
    returnUrl: `https://p2p-exchange-sigma.vercel.app?withdraw=done&id=${dealId}`,
  };
}

if (require.main === module) {
  processWithdrawals().then(r => {
    console.log("Withdraw result:", JSON.stringify(r));
    process.exit(0);
  });
}

module.exports = { processWithdrawals, autoReleaseAfterDeal, buildTONTransferPayload };
