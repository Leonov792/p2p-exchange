const { pool } = require("./db");
const { GUARANTOR, getTransactions, verifyIncomingPayment } = require("./ton-real");

async function depositUSDT(userId, txHash) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const existing = (await client.query(
      "SELECT * FROM deposits WHERE tx_hash = $1 FOR UPDATE", [txHash]
    )).rows[0];
    if (existing) throw Object.assign(new Error("Transaction already processed"), { statusCode: 409 });

    const txs = await getTransactions(GUARANTOR, 100);
    const match = txs.find((tx) => {
      const hash = tx.transaction_id?.hash || "";
      return hash === txHash || tx.in_msg?.source === userId?.toString();
    });

    if (!match) {
      await client.query(
        "INSERT INTO deposits (user_id, tx_hash, amount, status) VALUES ($1,$2,0,'pending')",
        [userId, txHash]
      );
      await client.query("COMMIT");
      return { deposited: false, status: "pending", reason: "Transaction not found on blockchain. Wait 1-2 minutes." };
    }

    const value = parseInt(match.in_msg?.value || "0") / 1e9;
    if (value <= 0) throw Object.assign(new Error("Zero value transaction"), { statusCode: 400 });

    await client.query(
      "INSERT INTO deposits (user_id, tx_hash, amount, status) VALUES ($1,$2,$3,'confirmed')",
      [userId, txHash, value]
    );

    await client.query(
      "UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE id = $2",
      [value, userId]
    );

    await client.query("COMMIT");

    const user = (await pool.query("SELECT balance FROM users WHERE id = $1", [userId])).rows[0];
    return { deposited: true, amount: value, newBalance: parseFloat(user?.balance || "0"), txHash };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function requestWithdrawal(userId, amount, recipientWallet) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const user = (await client.query(
      "SELECT balance, COALESCE(balance_frozen,0) as frozen FROM users WHERE id = $1 FOR UPDATE", [userId]
    )).rows[0];

    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

    const available = parseFloat(user.balance || "0") - parseFloat(user.frozen || "0");
    if (amount > available) {
      throw Object.assign(new Error("Insufficient balance. Available: " + available.toFixed(2) + " USDT"), { statusCode: 400 });
    }

    await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [amount, userId]);

    const w = (await client.query(
      "INSERT INTO withdrawals (user_id, recipient_wallet, amount, status) VALUES ($1,$2,$3,'pending') RETURNING *",
      [userId, recipientWallet || GUARANTOR, amount]
    )).rows[0];

    await client.query("COMMIT");

    return {
      withdrawn: true,
      id: w.id,
      amount,
      recipient: recipientWallet || GUARANTOR,
      status: "pending",
      newBalance: parseFloat(user.balance) - amount,
      note: "Withdrawal queued. Admin processes within 24h.",
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function getDepositHistory(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50", [userId]
  );
  return rows;
}

async function getWithdrawalHistory(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50", [userId]
  );
  return rows;
}

module.exports = { depositUSDT, requestWithdrawal, getDepositHistory, getWithdrawalHistory };
