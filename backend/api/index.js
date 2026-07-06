const { pool, migrate } = require("../lib/db");
const { GUARANTOR_WALLET, verifyDeposit } = require("../lib/ton");

let migrated = false;

function json(res, data, status = 200) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.status(status).send(JSON.stringify(data));
}

function getUserId(req) {
  const fromHeader = parseInt(req.headers["x-telegram-user-id"] || "0");
  if (fromHeader > 0) return fromHeader;
  const qs = (req.url || "").split("?")[1] || "";
  const params = new URLSearchParams(qs);
  return parseInt(params.get("user_id") || "0");
}

module.exports = async (req, res) => {
  if (!migrated) { await migrate(); migrated = true; }
  if (req.method === "OPTIONS") return json(res, { ok: true });

  let path = req.headers["x-vercel-original-url"] || req.url;
  path = path.replace(/\?.*/, "").replace(/\/+$/, "").replace(/^\/api/, "");

  const uid = getUserId(req);

  if (path === "/health") {
    return json(res, { status: "ok", db: true, guarantor: GUARANTOR_WALLET.slice(0, 10) + "..." });
  }

  if (path === "/stats") {
    const { rows } = await pool.query("SELECT COALESCE(SUM(volume_rub),0) as vol24, COALESCE(SUM(deals_count),0) as cnt24 FROM stats WHERE date >= CURRENT_DATE - 7");
    const { rows: totalDeals } = await pool.query("SELECT COUNT(*)::int as cnt FROM deals WHERE status='completed'");
    const { rows: activeUsers } = await pool.query("SELECT COUNT(*)::int as cnt FROM users WHERE created_at >= NOW() - INTERVAL '7 days'");
    return json(res, {
      volume24h: rows[0]?.vol24 || 0,
      deals24h: rows[0]?.cnt24 || 0,
      totalDeals: totalDeals[0]?.cnt || 0,
      activeUsers: activeUsers[0]?.cnt || 0,
      guarantorWallet: GUARANTOR_WALLET,
    });
  }

  if (!uid) {
    if (path === "/auth") {
      const u = req.body;
      if (!u || !u.id) return json(res, { error: "id required" }, 400);
      await pool.query("INSERT INTO users (id, username) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET username=$2", [u.id, u.username || ""]);
      return json(res, { success: true, user_id: u.id });
    }
    return json(res, { error: "Unauthorized" }, 401);
  }

  // Ensure user exists
  await pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [uid]);

  try {
    // GET /api/offers - list active offers
    if (path === "/offers" && req.method === "GET") {
      const qs = (req.url || "").split("?")[1] || "";
      const params = new URLSearchParams(qs);
      const type = params.get("type") || "";
      const sort = params.get("sort") || "price";

      let query = "SELECT o.*, u.username, u.rating, u.deals_completed FROM offers o JOIN users u ON o.user_id = u.id WHERE o.status = 'active'";
      const values = [];
      if (type === "buy" || type === "sell") { query += " AND o.type = $" + (values.length + 1); values.push(type); }
      if (sort === "price") query += " ORDER BY o.price_rub ASC";
      else query += " ORDER BY u.rating DESC";
      query += " LIMIT 50";

      const { rows } = await pool.query(query, values);
      return json(res, rows);
    }

    // POST /api/offers - create offer
    if (path === "/offers" && req.method === "POST") {
      const o = req.body;
      if (!o.type || !o.amount_usdt || !o.price_rub) return json(res, { error: "type, amount_usdt, price_rub required" }, 400);
      const { rows } = await pool.query(
        "INSERT INTO offers (user_id, type, amount_usdt, price_rub, min_amount_rub, max_amount_rub, payment_methods) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [uid, o.type, o.amount_usdt, o.price_rub, o.min_amount_rub || 0, o.max_amount_rub || 0, o.payment_methods || []]
      );
      return json(res, rows[0], 201);
    }

    // DELETE /api/offers/:id
    if (path.startsWith("/offers/") && req.method === "DELETE") {
      const id = path.split("/")[2];
      await pool.query("UPDATE offers SET status='cancelled' WHERE id=$1 AND user_id=$2", [id, uid]);
      return json(res, { success: true });
    }

    // POST /api/deals - create deal from offer
    if (path === "/deals" && req.method === "POST") {
      const d = req.body;
      if (!d.offer_id || !d.amount_usdt) return json(res, { error: "offer_id, amount_usdt required" }, 400);

      const offer = (await pool.query("SELECT * FROM offers WHERE id=$1 AND status='active'", [d.offer_id])).rows[0];
      if (!offer) return json(res, { error: "Offer not found or filled" }, 404);
      if (offer.user_id === uid) return json(res, { error: "Cannot trade with yourself" }, 400);

      const totalRub = parseFloat((d.amount_usdt * offer.price_rub).toFixed(2));
      const isBuy = offer.type === "sell";
      const buyerId = isBuy ? uid : offer.user_id;
      const sellerId = isBuy ? offer.user_id : uid;

      const { rows } = await pool.query(
        "INSERT INTO deals (offer_id, buyer_id, seller_id, amount_usdt, total_rub, payment_method, status) VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *",
        [offer.id, buyerId, sellerId, d.amount_usdt, totalRub, d.payment_method || "SBP"]
      );

      await pool.query("INSERT INTO stats (date, volume_rub, volume_usdt, deals_count) VALUES (CURRENT_DATE, $1, $2, 1) ON CONFLICT (date) DO UPDATE SET volume_rub = stats.volume_rub + $1, volume_usdt = stats.volume_usdt + $2, deals_count = stats.deals_count + 1",
        [totalRub, d.amount_usdt]);

      return json(res, rows[0], 201);
    }

    // GET /api/deals - my deals
    if (path === "/deals" && req.method === "GET") {
      const { rows } = await pool.query(
        "SELECT d.*, o.type as offer_type, o.payment_methods, u_b.username as buyer_name, u_s.username as seller_name FROM deals d JOIN offers o ON d.offer_id = o.id JOIN users u_b ON d.buyer_id = u_b.id JOIN users u_s ON d.seller_id = u_s.id WHERE d.buyer_id=$1 OR d.seller_id=$1 ORDER BY d.created_at DESC LIMIT 50",
        [uid]
      );
      return json(res, rows);
    }

    // PUT /api/deals/:id/lock - seller confirms USDT sent to guarantor
    if (path.match(/\/deals\/[^/]+\/lock/) && req.method === "PUT") {
      const dealId = path.split("/")[2];
      const deal = (await pool.query("SELECT * FROM deals WHERE id=$1 AND seller_id=$2 AND status='pending'", [dealId, uid])).rows[0];
      if (!deal) return json(res, { error: "Deal not found" }, 404);

      const txHash = req.body?.tx_hash || "";
      const verified = txHash ? await verifyDeposit(txHash, deal.amount_usdt, null) : true;

      if (verified) {
        await pool.query("UPDATE deals SET status='locked', escrow_tx_hash=$1 WHERE id=$2", [txHash, dealId]);
        return json(res, { success: true, status: "locked" });
      }
      return json(res, { error: "Transaction not verified on TON blockchain" }, 400);
    }

    // PUT /api/deals/:id/paid - buyer confirms RUB transfer
    if (path.match(/\/deals\/[^/]+\/paid/) && req.method === "PUT") {
      const dealId = path.split("/")[2];
      const deal = (await pool.query("SELECT * FROM deals WHERE id=$1 AND buyer_id=$2 AND status='locked'", [dealId, uid])).rows[0];
      if (!deal) return json(res, { error: "Deal not found or not locked" }, 404);

      await pool.query("UPDATE deals SET status='paid', buyer_tx_proof=$1 WHERE id=$2", [req.body?.proof || "", dealId]);
      return json(res, { success: true, status: "paid" });
    }

    // PUT /api/deals/:id/confirm - seller confirms RUB received
    if (path.match(/\/deals\/[^/]+\/confirm/) && req.method === "PUT") {
      const dealId = path.split("/")[2];
      const deal = (await pool.query("SELECT * FROM deals WHERE id=$1 AND seller_id=$2 AND status='paid'", [dealId, uid])).rows[0];
      if (!deal) return json(res, { error: "Deal not found or not paid" }, 404);

      await pool.query("UPDATE deals SET status='completed', seller_rub_confirmed=TRUE, completed_at=NOW() WHERE id=$1", [dealId]);
      await pool.query("UPDATE users SET deals_completed = deals_completed + 1 WHERE id = $1 OR id = $2", [deal.buyer_id, deal.seller_id]);
      await pool.query("UPDATE offers SET status = CASE WHEN amount_usdt <= (SELECT COALESCE(SUM(amount_usdt),0) FROM deals WHERE offer_id=$1 AND status='completed') THEN 'filled' ELSE 'active' END WHERE id=$1", [deal.offer_id]);
      return json(res, { success: true, status: "completed" });
    }

    // PUT /api/deals/:id/dispute - open dispute
    if (path.match(/\/deals\/[^/]+\/dispute/) && req.method === "PUT") {
      const dealId = path.split("/")[2];
      await pool.query("UPDATE deals SET status='disputed' WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)", [dealId, uid]);
      await pool.query("INSERT INTO disputes (deal_id, initiator_id, reason) VALUES ($1,$2,$3)", [dealId, uid, req.body?.reason || ""]);
      return json(res, { success: true, status: "disputed" });
    }

    // Stars payment
    if (path === "/stars/pay" && req.method === "POST") {
      const { amount, description } = req.body || {};
      if (!amount) return json(res, { error: "amount required" }, 400);
      await pool.query("INSERT INTO deals (offer_id, buyer_id, seller_id, amount_usdt, total_rub, payment_method, status) VALUES ($1,$2,$3,$4,$5,$6,'stars_paid')",
        [null, uid, 0, amount, amount, "STARS"]);
      return json(res, { success: true, stars: amount });
    }

    if (path === "/stars/balance") {
      const { rows } = await pool.query("SELECT COALESCE(SUM(total_rub),0) as total FROM deals WHERE buyer_id=$1 AND payment_method='STARS' AND status='stars_paid'", [uid]);
      return json(res, { balance: rows[0]?.total || 0 });
    }

    // GET/PUT /api/profile
    if (path === "/profile" && req.method === "GET") {
      const { rows } = await pool.query(
        "SELECT id, username, ton_wallet, rating, deals_completed, deals_cancelled, balance_frozen, created_at FROM users WHERE id=$1",
        [uid]
      );
      if (!rows[0]) return json(res, { error: "User not found" }, 404);
      return json(res, rows[0]);
    }

    if (path === "/profile" && req.method === "PUT") {
      const u = req.body;
      await pool.query("UPDATE users SET ton_wallet = COALESCE($1, ton_wallet) WHERE id = $2", [u.ton_wallet || null, uid]);
      return json(res, { success: true });
    }

    // ADMIN: GET /api/admin/deals
    if (path === "/admin/deals" && req.method === "GET") {
      const { rows } = await pool.query(
        "SELECT d.*, u_b.username as buyer_name, u_s.username as seller_name FROM deals d JOIN users u_b ON d.buyer_id = u_b.id JOIN users u_s ON d.seller_id = u_s.id ORDER BY d.created_at DESC LIMIT 100"
      );
      return json(res, rows);
    }

    // ADMIN: PUT /api/admin/disputes/:id
    if (path.match(/\/admin\/disputes\/[^/]+/) && req.method === "PUT") {
      const disputeId = path.split("/")[3];
      const decision = req.body?.decision;
      const dispute = (await pool.query("SELECT * FROM disputes WHERE id=$1", [disputeId])).rows[0];
      if (!dispute) return json(res, { error: "Dispute not found" }, 404);

      await pool.query("UPDATE disputes SET status=$1, resolved_by=$2, resolved_at=NOW() WHERE id=$3", [decision, uid, disputeId]);
      const dealStatus = decision === "resolved_buyer" ? "completed" : "cancelled";
      await pool.query("UPDATE deals SET status=$1 WHERE id=$2", [dealStatus, dispute.deal_id]);
      return json(res, { success: true });
    }

    // ADMIN: GET /api/admin/stats
    if (path === "/admin/stats" && req.method === "GET") {
      const { rows: stats } = await pool.query("SELECT * FROM stats ORDER BY date DESC LIMIT 30");
      const { rows: disputess } = await pool.query("SELECT COUNT(*)::int as open FROM disputes WHERE status='open'");
      return json(res, { daily: stats, openDisputes: disputess[0]?.open || 0 });
    }

    json(res, { status: "ok", message: "P2P Exchange API v1" });
  } catch (e) {
    console.error("API Error:", e);
    json(res, { error: "Internal server error" }, 500);
  }
};
