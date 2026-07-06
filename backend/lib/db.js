const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_q3zRB4hiGEsk@ep-calm-bar-atzg09ti.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      username TEXT,
      ton_wallet TEXT DEFAULT '',
      rating DECIMAL(3,2) DEFAULT 0,
      deals_completed INT DEFAULT 0,
      deals_cancelled INT DEFAULT 0,
      balance_frozen DECIMAL(20,6) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS offers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('buy','sell')),
      amount_usdt DECIMAL(20,6) NOT NULL,
      price_rub DECIMAL(15,2) NOT NULL,
      min_amount_rub DECIMAL(15,2) DEFAULT 0,
      max_amount_rub DECIMAL(15,2) DEFAULT 0,
      payment_methods TEXT[] DEFAULT '{}',
      status TEXT DEFAULT 'active' CHECK (status IN ('active','filled','cancelled')),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      offer_id UUID REFERENCES offers(id),
      buyer_id BIGINT REFERENCES users(id),
      seller_id BIGINT REFERENCES users(id),
      amount_usdt DECIMAL(20,6) NOT NULL,
      total_rub DECIMAL(15,2) NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','locked','paid','completed','cancelled','disputed')),
      escrow_tx_hash TEXT,
      release_tx_hash TEXT,
      payment_method TEXT,
      buyer_tx_proof TEXT DEFAULT '',
      seller_rub_confirmed BOOLEAN DEFAULT FALSE,
      buyer_usdt_confirmed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS disputes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deal_id UUID REFERENCES deals(id),
      initiator_id BIGINT REFERENCES users(id),
      reason TEXT,
      status TEXT DEFAULT 'open' CHECK (status IN ('open','resolved_buyer','resolved_seller')),
      resolved_by BIGINT,
      resolved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stats (
      date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
      volume_rub DECIMAL(20,2) DEFAULT 0,
      volume_usdt DECIMAL(20,6) DEFAULT 0,
      deals_count INT DEFAULT 0,
      users_active INT DEFAULT 0
    )
  `);
  console.log("Database migrated");
}

module.exports = { pool, migrate };
