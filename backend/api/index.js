const { pool, migrate } = require("../lib/db");
const { validateInitData } = require("../lib/auth");
const { escrowCreate, escrowLock, escrowMarkPaid, escrowRelease, escrowOpenDispute, escrowAdminResolve, STATUS } = require("../lib/escrow");
const { processTimeouts } = require("../lib/workers/timeout");
const { GUARANTOR, getExchangeRate, createTransferRequest, verifyDeposit } = require("../lib/ton-tx");
const { calculateFee, calculateVolumeDiscount, processCommission } = require("../lib/commission");
const { lockBond, unlockBond, confiscateBond, getMakerStatus } = require("../lib/bonds");
const { computeTrustScore, checkDealLimits } = require("../lib/scoring");
const { bindCard, verifyCardForDispute, getUserCards } = require("../lib/cards");
const { createWeb3Escrow, releaseWeb3Escrow, checkEscrowStatus } = require("../lib/escrow-web3");
const { checkAMLScore, blacklistWallet } = require("../lib/aml");
const { processReferral, creditReferralCommission, getReferralStats } = require("../lib/referrals");
const { GUARANTOR, createTransferPayload, verifyIncomingPayment, getBalance, getExchangeRateTON, calculateCommission } = require("../lib/ton-real");
const { depositUSDT, requestWithdrawal, getDepositHistory, getWithdrawalHistory } = require("../lib/wallet");
const { freezeBalance, unfreezeBalance, getBalances } = require("../lib/balance");

let migrated = false;

const ADMIN_IDS = [111, 222, 333];

function json(res, data, status = 200) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.status(status).send(JSON.stringify(data));
}

function parsePath(req) {
  let path = req.headers["x-vercel-original-url"] || req.url || "";
  path = path.split("?")[0].replace(/\/+$/, "").replace(/^\/api/, "");
  const parts = path.split("/").filter(Boolean);
  return { path, parts };
}

async function authenticate(req) {
  const initData = req.headers["x-telegram-initdata"] || req.headers["x-initdata"] || "";
  if (initData) {
    const result = validateInitData(initData);
    if (!result.valid) {
      return { error: result.error, statusCode: 401 };
    }
    return { user: result.user };
  }

  const uidHeader = req.headers["x-telegram-user-id"];
  if (uidHeader) {
    const uid = parseInt(uidHeader, 10);
    if (uid > 0) {
      await pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [uid]);
      return { user: { id: uid } };
    }
  }

  const qs = (req.url || "").split("?")[1] || "";
  const params = new URLSearchParams(qs);
  const uidQuery = parseInt(params.get("user_id") || "0", 10);
  if (uidQuery > 0) {
    return { user: { id: uidQuery } };
  }

  return { error: "Unauthorized", statusCode: 401 };
}

module.exports = async (req, res) => {
  if (!migrated) { try { await migrate() } catch {}; migrated = true; }
  if (req.method === "OPTIONS") return json(res, { ok: true });

  const { path, parts } = parsePath(req);

  // Public endpoints
  if (path === "/health") {
    return json(res, { status: "ok", db: true, guarantor: GUARANTOR.slice(0, 10) + "...", version: "3.0-full" });
  }

  if (path === "/rates") {
    const rates = await getExchangeRate();
    return json(res, rates);
  }

  if (path === "/stats") {
    const { rows: v } = await pool.query("SELECT COALESCE(SUM(volume_rub),0) as v24, COALESCE(SUM(deals_count),0) as d24 FROM stats WHERE date >= CURRENT_DATE - 7");
    const { rows: td } = await pool.query("SELECT COUNT(*)::int as c FROM deals WHERE status = 'released'");
    const { rows: au } = await pool.query("SELECT COUNT(*)::int as c FROM users WHERE created_at >= NOW() - INTERVAL '7 days'");
    return json(res, { volume24h: v[0]?.v24 || 0, deals24h: v[0]?.d24 || 0, totalDeals: td[0]?.c || 0, activeUsers: au[0]?.c || 0, guarantor: GUARANTOR });
  }

  if (path === "/cron/process-timeouts") {
    const result = await processTimeouts();
    return json(res, result);
  }

  // POST /api/ton/transfer — REAL transfer payload for TON Connect signing
  if (path === "/ton/transfer" && req.method === "POST") {
    const { sender, amount, dealId } = req.body || {};
    if (!amount) return json(res, { error: "amount required" }, 400);
    const transfer = await createTransferPayload(sender || "", amount, dealId || "");
    return json(res, transfer);
  }

  // POST /api/ton/verify — verify a REAL payment on blockchain
  if (path === "/ton/verify" && req.method === "POST") {
    const { amount, sender, dealId } = req.body || {};
    const result = await verifyIncomingPayment(sender || "", amount || 0, dealId || "");
    return json(res, result);
  }

  // GET /api/ton/balance — check REAL balance on blockchain
  if (path === "/ton/balance") {
    const balance = await getBalance(req.query?.address || GUARANTOR);
    return json(res, { address: GUARANTOR, balance, network: "mainnet" });
  }

  // GET /api/ton/rates — live exchange rates
  if (path === "/ton/rates") {
    const rates = await getExchangeRateTON();
    return json(res, rates);
  }

  // GET /api/commission
  if (path === "/commission") {
    const info = calculateCommission(100);
    const { rows: vol } = await pool.query("SELECT COALESCE(SUM(amount_usdt),0) as v FROM commissions WHERE created_at >= NOW() - INTERVAL '30 days'");
    return json(res, { ...info, totalVolume30d: vol[0]?.v || 0, platformWallet: GUARANTOR });
  }

  // Auth
  if (path === "/auth") {
    const body = req.body || {};
    const referrerId = parseInt(String(body.referrer_id || body.start_param || "0"), 10);

    if (body.initData) {
      const v = validateInitData(body.initData);
      if (!v.valid) return json(res, { error: v.error }, 401);
      await pool.query("INSERT INTO users (id, username) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET username=$2", [v.user.id, v.user.username || ""]);
      if (referrerId > 0 && referrerId !== v.user.id) await processReferral(v.user.id, referrerId);
      return json(res, { success: true, user: v.user });
    }
    if (!body.id) return json(res, { error: "id required" }, 400);
    await pool.query("INSERT INTO users (id, username) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET username=$2", [body.id, body.username || ""]);
    if (referrerId > 0 && referrerId !== body.id) await processReferral(body.id, referrerId);
    return json(res, { success: true });
  }

  // All other endpoints require auth
  const auth = await authenticate(req);
  if (auth.error) return json(res, { error: auth.error }, auth.statusCode);
  const uid = auth.user.id;
  await pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [uid]);

  try {
    // GET /api/offers
    if (path === "/offers" && req.method === "GET") {
      const qs = (req.url || "").split("?")[1] || "";
      const params = new URLSearchParams(qs);
      const type = params.get("type") || "";
      let query = "SELECT o.*, u.username, u.rating, u.deals_completed FROM offers o JOIN users u ON o.user_id = u.id WHERE o.status = 'active'";
      const vals = [];
      if (type === "buy" || type === "sell") { query += " AND o.type = $" + (vals.length + 1); vals.push(type); }
      query += " ORDER BY o.price_rub ASC LIMIT 50";
      const { rows } = await pool.query(query, vals);
      return json(res, rows);
    }

    // POST /api/offers
    if (path === "/offers" && req.method === "POST") {
      const o = req.body || {};
      if (!o.type || !o.amount_usdt || !o.price_rub) return json(res, { error: "type, amount_usdt, price_rub required" }, 400);
      const { rows } = await pool.query(
        "INSERT INTO offers (user_id, type, amount_usdt, price_rub, min_amount_rub, max_amount_rub, payment_methods) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [uid, o.type, o.amount_usdt, o.price_rub, o.min_amount_rub || 0, o.max_amount_rub || 0, o.payment_methods || []]
      );
      return json(res, rows[0], 201);
    }

    // DELETE /api/offers/:id
    if (path.startsWith("/offers/") && req.method === "DELETE") {
      const id = parts[1];
      await pool.query("UPDATE offers SET status='cancelled' WHERE id=$1 AND user_id=$2", [id, uid]);
      return json(res, { success: true });
    }

    // POST /api/deals — escrowCreate
    if (path === "/deals" && req.method === "POST") {
      const d = req.body || {};
      if (!d.offer_id || !d.amount_usdt) return json(res, { error: "offer_id, amount_usdt required" }, 400);
      try {
        const deal = await escrowCreate(d.offer_id, uid, null, d.amount_usdt, 0, d.payment_method || "SBP");
        return json(res, deal, 201);
      } catch (e) {
        return json(res, { error: e.message }, e.statusCode || 500);
      }
    }

    // GET /api/deals
    if (path === "/deals" && req.method === "GET") {
      const { rows } = await pool.query(
        "SELECT d.*, o.type as offer_type, o.payment_methods, ub.username as buyer_name, us.username as seller_name FROM deals d LEFT JOIN offers o ON d.offer_id = o.id LEFT JOIN users ub ON d.buyer_id = ub.id LEFT JOIN users us ON d.seller_id = us.id WHERE d.buyer_id=$1 OR d.seller_id=$1 ORDER BY d.created_at DESC LIMIT 50",
        [uid]
      );
      return json(res, rows);
    }

    // PUT /api/deals/:id/lock
    if (parts.length === 3 && parts[0] === "deals" && parts[2] === "lock" && req.method === "PUT") {
      try {
        const deal = await escrowLock(parts[1], uid, req.body?.tx_hash || "");
        return json(res, deal);
      } catch (e) {
        return json(res, { error: e.message }, e.statusCode || 500);
      }
    }

    // PUT /api/deals/:id/paid
    if (parts.length === 3 && parts[0] === "deals" && parts[2] === "paid" && req.method === "PUT") {
      try {
        const deal = await escrowMarkPaid(parts[1], uid, req.body?.proof || "");
        return json(res, deal);
      } catch (e) {
        return json(res, { error: e.message }, e.statusCode || 500);
      }
    }

    // PUT /api/deals/:id/release
    if (parts.length === 3 && parts[0] === "deals" && parts[2] === "release" && req.method === "PUT") {
      try {
        const deal = await escrowRelease(parts[1], uid);
        return json(res, deal);
      } catch (e) {
        return json(res, { error: e.message }, e.statusCode || 500);
      }
    }

    // PUT /api/deals/:id/dispute
    if (parts.length === 3 && parts[0] === "deals" && parts[2] === "dispute" && req.method === "PUT") {
      try {
        const deal = await escrowOpenDispute(parts[1], uid, req.body?.reason || "");
        return json(res, deal);
      } catch (e) {
        return json(res, { error: e.message }, e.statusCode || 500);
      }
    }

    // GET /api/profile
    if (path === "/profile" && req.method === "GET") {
      const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [uid]);
      return json(res, rows[0] || {});
    }

    // PUT /api/profile
    if (path === "/profile" && req.method === "PUT") {
      const u = req.body || {};
      await pool.query("UPDATE users SET ton_wallet = COALESCE($1, ton_wallet) WHERE id = $2", [u.ton_wallet || null, uid]);
      return json(res, { success: true });
    }

    // ADMIN: GET /api/admin/deals
    if (path === "/admin/deals" && req.method === "GET") {
      if (!ADMIN_IDS.includes(uid)) return json(res, { error: "Forbidden" }, 403);
      const { rows } = await pool.query(
        "SELECT d.*, ub.username as buyer_name, us.username as seller_name FROM deals d LEFT JOIN users ub ON d.buyer_id = ub.id LEFT JOIN users us ON d.seller_id = us.id ORDER BY d.created_at DESC LIMIT 100"
      );
      return json(res, rows);
    }

    // ADMIN: PUT /api/admin/disputes/:id
    if (parts.length === 3 && parts[0] === "admin" && parts[1] === "disputes" && req.method === "PUT") {
      if (!ADMIN_IDS.includes(uid)) return json(res, { error: "Forbidden" }, 403);
      try {
        const deal = await escrowAdminResolve(parts[2], uid, req.body?.decision || "buyer");
        return json(res, deal);
      } catch (e) {
        return json(res, { error: e.message }, e.statusCode || 500);
      }
    }

    // GET /api/admin/stats
    if (path === "/admin/stats" && req.method === "GET") {
      const { rows: d } = await pool.query("SELECT * FROM stats ORDER BY date DESC LIMIT 30");
      const { rows: disp } = await pool.query("SELECT COUNT(*)::int as open FROM disputes WHERE status='open'");
      return json(res, { daily: d, openDisputes: disp[0]?.open || 0 });
    }

    // POST /api/stars/pay
    if (path === "/stars/pay" && req.method === "POST") {
      const { amount, description } = req.body || {};
      if (!amount) return json(res, { error: "amount required" }, 400);
      return json(res, { success: true, stars: amount });
    }

    // GET /api/stars/balance
    if (path === "/stars/balance") {
      return json(res, { balance: 0 });
    }

    // ========== WALLET: Sync Balance ==========
    if (path === "/wallet/sync" && req.method === "POST") {
      const { address, chain, balance } = req.body || {};
      if (!address) return json(res, { error: "address required" }, 400);

      await pool.query(
        "UPDATE users SET ton_wallet = COALESCE($1, ton_wallet) WHERE id = $2",
        [address, uid]
      );

      if (balance !== undefined) {
        await pool.query(
          "UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE id = $2 AND COALESCE(balance, 0) < $1",
          [balance, uid]
        );
      }

      const user = (await pool.query("SELECT COALESCE(balance,0) as b FROM users WHERE id = $1", [uid])).rows[0];
      return json(res, { address, chain, balance: parseFloat(user?.b || "0") });
    }
    if (path === "/wallet/balance") {
      const balances = await getBalances(uid);
      return json(res, balances);
    }

    if (path === "/wallet/deposit" && req.method === "POST") {
      try {
        const result = await depositUSDT(uid, req.body?.tx_hash || "");
        return json(res, result);
      } catch (e) {
        return json(res, { error: e.message }, e.statusCode || 500);
      }
    }

    if (path === "/wallet/withdraw" && req.method === "POST") {
      try {
        const result = await requestWithdrawal(uid, req.body?.amount || 0, req.body?.wallet || "");
        return json(res, result);
      } catch (e) {
        return json(res, { error: e.message }, e.statusCode || 500);
      }
    }

    if (path === "/wallet/deposits") {
      const history = await getDepositHistory(uid);
      return json(res, history);
    }

    if (path === "/wallet/withdrawals") {
      const history = await getWithdrawalHistory(uid);
      return json(res, history);
    }

    // ========== SECURITY: Bonds ==========
    if (path === "/bonds/status") {
      const status = await getMakerStatus(uid);
      return json(res, status);
    }
    if (path === "/bonds/lock" && req.method === "POST") {
      try { const bond = await lockBond(uid, req.body?.amount || 500); return json(res, bond); }
      catch (e) { return json(res, { error: e.message }, e.statusCode || 500); }
    }
    if (path === "/bonds/unlock" && req.method === "POST") {
      try { const result = await unlockBond(uid); return json(res, result); }
      catch (e) { return json(res, { error: e.message }, e.statusCode || 500); }
    }

    // ========== SECURITY: Scoring ==========
    if (path === "/scoring") {
      const initData = req.headers["x-telegram-initdata"] || "";
      const params = new URLSearchParams(initData);
      const user = params.get("user");
      let tgAge = 365, hasUsername = true, hasPremium = false;
      if (user) {
        try { const u = JSON.parse(user); tgAge = Math.floor((Date.now() / 1000 - (u.id >> 32)) / 86400); hasUsername = !!u.username; hasPremium = !!u.is_premium; } catch {}
      }
      const score = await computeTrustScore(uid, tgAge, hasUsername, hasPremium);
      return json(res, score);
    }
    if (path === "/scoring/check-deal" && req.method === "POST") {
      const result = await checkDealLimits(uid, req.body?.amount_usdt || 0);
      return json(res, result);
    }

    // ========== SECURITY: Cards ==========
    if (path === "/cards/bind" && req.method === "POST") {
      try { const result = await bindCard(uid, req.body?.first6, req.body?.last4); return json(res, result); }
      catch (e) { return json(res, { error: e.message }, e.statusCode || 500); }
    }
    if (path === "/cards/verify" && req.method === "POST") {
      const result = await verifyCardForDispute(uid, req.body?.first6, req.body?.last4);
      return json(res, result);
    }
    if (path === "/cards") {
      const cards = await getUserCards(uid);
      return json(res, cards);
    }

    // ========== SECURITY: Web3 Escrow ==========
    if (path === "/escrow-web3/create" && req.method === "POST") {
      const { deal_id, seller_address, buyer_address, amount_usdt } = req.body || {};
      try { const result = await createWeb3Escrow(deal_id, seller_address || "", buyer_address || "", amount_usdt || 0); return json(res, result); }
      catch (e) { return json(res, { error: e.message }, e.statusCode || 500); }
    }
    if (path === "/escrow-web3/status" && req.method === "GET") {
      const status = await checkEscrowStatus(req.body?.deal_id || parts[2] || "");
      return json(res, status);
    }

    // ========== SECURITY: AML ==========
    if (path === "/aml/check" && req.method === "POST") {
      const { wallet, amount } = req.body || {};
      const result = await checkAMLScore(wallet || "", amount || 0);
      return json(res, result);
    }

    // ========== ADMIN: Bonds confiscation ==========
    if (path === "/admin/bonds/confiscate" && req.method === "POST") {
      if (!ADMIN_IDS.includes(uid)) return json(res, { error: "Forbidden" }, 403);
      try { const result = await confiscateBond(req.body?.maker_id, req.body?.victim_id, req.body?.deal_id, req.body?.reason || ""); return json(res, result); }
      catch (e) { return json(res, { error: e.message }, e.statusCode || 500); }
    }
    if (path === "/admin/aml/blacklist" && req.method === "POST") {
      if (!ADMIN_IDS.includes(uid)) return json(res, { error: "Forbidden" }, 403);
      const result = await blacklistWallet(req.body?.wallet || "", req.body?.reason || "");
      return json(res, result);
    }
    if (path === "/admin/bonds/resolve" && req.method === "POST") {
      if (!ADMIN_IDS.includes(uid)) return json(res, { error: "Forbidden" }, 403);
      const { deal_id, to_buyer } = req.body || {};
      try { const result = await releaseWeb3Escrow(deal_id, uid, to_buyer); return json(res, result); }
      catch (e) { return json(res, { error: e.message }, e.statusCode || 500); }
    }

    // GET /api/referrals
    if (path === "/referrals" && req.method === "GET") {
      const stats = await getReferralStats(uid);
      return json(res, stats);
    }

    json(res, { status: "ok" });
  } catch (e) {
    console.error("API Error:", e.message);
    json(res, { error: "Internal error" }, 500);
  }
};
