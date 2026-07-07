const { pool, migrate } = require("../lib/db");
const { validateInitData } = require("../lib/auth");
const { escrowCreate, escrowLock, escrowMarkPaid, escrowRelease, escrowOpenDispute, escrowAdminResolve, STATUS } = require("../lib/escrow");
const { processTimeouts } = require("../lib/workers/timeout");
const { GUARANTOR_WALLET } = require("../lib/ton");

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
    return json(res, { status: "ok", db: true, guarantor: GUARANTOR_WALLET.slice(0, 10) + "...", version: "2.0-secure" });
  }

  if (path === "/stats") {
    const { rows: v } = await pool.query("SELECT COALESCE(SUM(volume_rub),0) as v24, COALESCE(SUM(deals_count),0) as d24 FROM stats WHERE date >= CURRENT_DATE - 7");
    const { rows: td } = await pool.query("SELECT COUNT(*)::int as c FROM deals WHERE status = 'released'");
    const { rows: au } = await pool.query("SELECT COUNT(*)::int as c FROM users WHERE created_at >= NOW() - INTERVAL '7 days'");
    return json(res, { volume24h: v[0]?.v24 || 0, deals24h: v[0]?.d24 || 0, totalDeals: td[0]?.c || 0, activeUsers: au[0]?.c || 0, guarantor: GUARANTOR_WALLET });
  }

  if (path === "/cron/process-timeouts") {
    const result = await processTimeouts();
    return json(res, result);
  }

  // Auth
  if (path === "/auth") {
    const body = req.body || {};
    if (body.initData) {
      const v = validateInitData(body.initData);
      if (!v.valid) return json(res, { error: v.error }, 401);
      await pool.query("INSERT INTO users (id, username) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET username=$2", [v.user.id, v.user.username || ""]);
      return json(res, { success: true, user: v.user });
    }
    if (!body.id) return json(res, { error: "id required" }, 400);
    await pool.query("INSERT INTO users (id, username) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET username=$2", [body.id, body.username || ""]);
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

    json(res, { status: "ok" });
  } catch (e) {
    console.error("API Error:", e.message);
    json(res, { error: "Internal error" }, 500);
  }
};
