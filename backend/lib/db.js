const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_q3zRB4hiGEsk@ep-calm-bar-atzg09ti.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY, username TEXT, ton_wallet TEXT DEFAULT '',
      rating DECIMAL(3,2) DEFAULT 0, deals_completed INT DEFAULT 0,
      deals_cancelled INT DEFAULT 0, balance_frozen DECIMAL(20,6) DEFAULT 0,
      is_admin BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS offers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id BIGINT REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('buy','sell')),
      amount_usdt DECIMAL(20,6) NOT NULL, price_rub DECIMAL(15,2) NOT NULL,
      min_amount_rub DECIMAL(15,2) DEFAULT 0, max_amount_rub DECIMAL(15,2) DEFAULT 0,
      payment_methods TEXT[] DEFAULT '{}',
      status TEXT DEFAULT 'active' CHECK (status IN ('active','filled','cancelled')),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      offer_id UUID REFERENCES offers(id), buyer_id BIGINT REFERENCES users(id),
      seller_id BIGINT REFERENCES users(id),
      amount_usdt DECIMAL(20,6) NOT NULL, total_rub DECIMAL(15,2) NOT NULL,
      status TEXT DEFAULT 'created' CHECK (status IN ('created','locked','paid','disputed','released','cancelled','timed_out')),
      escrow_tx_hash TEXT, release_tx_hash TEXT, payment_method TEXT,
      buyer_tx_proof TEXT DEFAULT '', seller_rub_confirmed BOOLEAN DEFAULT FALSE,
      payment_deadline TIMESTAMP, confirm_deadline TIMESTAMP, locked_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(), completed_at TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_log (
      id SERIAL PRIMARY KEY, deal_id UUID REFERENCES deals(id),
      from_status TEXT, to_status TEXT NOT NULL, actor_id BIGINT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS disputes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), deal_id UUID REFERENCES deals(id),
      initiator_id BIGINT REFERENCES users(id), reason TEXT,
      status TEXT DEFAULT 'open' CHECK (status IN ('open','resolved_buyer','resolved_seller')),
      resolved_by BIGINT, resolved_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stats (
      date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
      volume_rub DECIMAL(20,2) DEFAULT 0, volume_usdt DECIMAL(20,6) DEFAULT 0,
      deals_count INT DEFAULT 0, users_active INT DEFAULT 0
    )
  `);

  // Add missing columns without breaking existing data
  await pool.query(`
    CREATE TABLE IF NOT EXISTS commissions (
      id SERIAL PRIMARY KEY,
      deal_id UUID REFERENCES deals(id),
      amount_usdt DECIMAL(20,6) NOT NULL,
      fee_usdt DECIMAL(20,6) NOT NULL,
      fee_percent DECIMAL(4,2) DEFAULT 2.0,
      platform_wallet TEXT DEFAULT 'UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS maker_bonds (
      id SERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id),
      amount DECIMAL(20,6) NOT NULL DEFAULT 500, status TEXT DEFAULT 'active',
      locked_until TIMESTAMP, released_at TIMESTAMP,
      confiscated_amount DECIMAL(20,6) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS confiscations (
      id SERIAL PRIMARY KEY, bond_id INTEGER REFERENCES maker_bonds(id),
      maker_id BIGINT REFERENCES users(id), victim_id BIGINT REFERENCES users(id),
      deal_id UUID, amount DECIMAL(20,6) NOT NULL, reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS card_hashes (
      id SERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id),
      card_hash TEXT NOT NULL, masked_card TEXT,
      last_used TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web3_escrows (
      id SERIAL PRIMARY KEY, deal_id UUID UNIQUE REFERENCES deals(id),
      seller_address TEXT, buyer_address TEXT, contract_address TEXT,
      amount_usdt DECIMAL(20,6) NOT NULL, network TEXT DEFAULT 'mainnet',
      status TEXT DEFAULT 'awaiting_deposit', resolved_by BIGINT,
      resolved_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aml_checks (
      id SERIAL PRIMARY KEY, wallet_address TEXT NOT NULL,
      amount_usdt DECIMAL(20,6) DEFAULT 0, risk_score INTEGER DEFAULT 0,
      flags JSONB DEFAULT '[]', created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY, referrer_id BIGINT REFERENCES users(id),
      referred_id BIGINT UNIQUE REFERENCES users(id),
      status TEXT DEFAULT 'active', created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_commissions (
      id SERIAL PRIMARY KEY, deal_id UUID REFERENCES deals(id),
      referrer_id BIGINT REFERENCES users(id), referred_id BIGINT REFERENCES users(id),
      amount_usdt DECIMAL(20,6) NOT NULL, rate DECIMAL(5,4) DEFAULT 0.005,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deposits (
      id SERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id),
      tx_hash TEXT UNIQUE, amount DECIMAL(20,6) DEFAULT 0,
      status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id),
      recipient_wallet TEXT, amount DECIMAL(20,6) NOT NULL,
      status TEXT DEFAULT 'pending', tx_hash TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const cols = [
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS payment_deadline TIMESTAMP",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS confirm_deadline TIMESTAMP",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_maker BOOLEAN DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_bonus INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_earnings DECIMAL(20,6) DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS balance DECIMAL(20,6) DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_frozen DECIMAL(20,6) DEFAULT 0",
    "ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS deal_id UUID",
  ];
  for (const q of cols) {
    await pool.query(q).catch(() => {});
  }

  console.log("Database migrated");
}

module.exports = { pool, migrate };
