const { pool } = require("./db");

async function freezeBalance(client, userId, amount) {
  const user = (await client.query(
    "SELECT balance, COALESCE(balance_frozen,0) as frozen FROM users WHERE id = $1 FOR UPDATE", [userId]
  )).rows[0];

  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  const available = parseFloat(user.balance || "0") - parseFloat(user.frozen || "0");
  if (amount > available) {
    throw Object.assign(new Error("Insufficient available balance: " + available.toFixed(2) + " USDT (need " + amount + ")"), { statusCode: 400 });
  }

  await client.query(
    "UPDATE users SET balance_frozen = COALESCE(balance_frozen, 0) + $1 WHERE id = $2",
    [amount, userId]
  );
  return { frozen: parseFloat(user.frozen || "0") + amount, available: available - amount };
}

async function unfreezeBalance(client, userId, amount) {
  await client.query(
    "UPDATE users SET balance_frozen = GREATEST(COALESCE(balance_frozen, 0) - $1, 0) WHERE id = $2",
    [amount, userId]
  );
}

async function transferBalance(client, fromUserId, toUserId, amount) {
  const from = (await client.query(
    "SELECT balance, COALESCE(balance_frozen,0) as frozen FROM users WHERE id = $1 FOR UPDATE", [fromUserId]
  )).rows[0];

  if (!from) throw Object.assign(new Error("Sender not found"), { statusCode: 404 });

  const available = parseFloat(from.balance || "0") - parseFloat(from.frozen || "0");
  if (amount > available) {
    throw Object.assign(new Error("Insufficient balance"), { statusCode: 400 });
  }

  await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [amount, fromUserId]);

  const to = (await client.query("SELECT id FROM users WHERE id = $1", [toUserId])).rows[0];
  if (!to) {
    await client.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [toUserId]);
  }
  await client.query("UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE id = $2", [amount, toUserId]);
}

async function getBalances(userId) {
  const user = (await pool.query(
    "SELECT COALESCE(balance,0) as balance, COALESCE(balance_frozen,0) as frozen FROM users WHERE id = $1", [userId]
  )).rows[0];

  return {
    balance: parseFloat(user?.balance || "0"),
    frozen: parseFloat(user?.frozen || "0"),
    available: parseFloat((user?.balance || "0")) - parseFloat((user?.frozen || "0")),
  };
}

module.exports = { freezeBalance, unfreezeBalance, transferBalance, getBalances };
