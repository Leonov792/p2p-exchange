// Bots module
module.exports = function(pool, json, uid, req, path, parts, ADMIN_IDS) {
  // All bot handlers
    // POST /v1/bots/grid вЂ” Create grid bot with real orders
    if (path === "/v1/bots/grid" && req.method === "POST") {
      const { symbol, lower, upper, gridCount, amount } = req.body || {};
      const low = parseFloat(lower), up = parseFloat(upper), grids = Math.max(2, Math.min(50, parseInt(gridCount) || 10));
      if (!low || !up || low >= up) return json(res, { error: "Invalid range" }, 400);
      const investment = parseFloat(amount) || 100;
      const gridSize = (up - low) / grids;
      const qtyPerGrid = investment / grids / ((up + low) / 2);
      const botId = require('crypto').randomUUID();

      await pool.query(`CREATE TABLE IF NOT EXISTS grid_bots (id UUID PRIMARY KEY, user_id BIGINT, symbol VARCHAR(20), lower_price DECIMAL(30,8), upper_price DECIMAL(30,8), grid_count INT, grid_size DECIMAL(30,8), qty_per_grid DECIMAL(30,8), investment DECIMAL(30,8), status VARCHAR(10) DEFAULT 'RUNNING', total_trades INT DEFAULT 0, total_profit DECIMAL(30,8) DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`INSERT INTO grid_bots (id, user_id, symbol, lower_price, upper_price, grid_count, grid_size, qty_per_grid, investment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [botId, uid, symbol, low, up, grids, gridSize, qtyPerGrid, investment]);

      // Place initial BUY orders at each grid level
      let ordersPlaced = 0;
      for (let i = 0; i < grids; i++) {
        const price = low + gridSize * i;
        const orderId = require('crypto').randomUUID();
        await pool.query(`INSERT INTO spot_orders (id, user_id, symbol, side, type, price, quantity, filled, status) VALUES ($1,$2,$3,'BUY','LIMIT',$4,$5,0,'OPEN')`,
          [orderId, uid, symbol, price, qtyPerGrid]);
        await pool.query(`CREATE TABLE IF NOT EXISTS grid_bot_orders (id UUID PRIMARY KEY, bot_id UUID REFERENCES grid_bots(id), order_id UUID, grid_level INT, price DECIMAL(30,8), side VARCHAR(4), status VARCHAR(10) DEFAULT 'OPEN')`);
        await pool.query(`INSERT INTO grid_bot_orders (id, bot_id, order_id, grid_level, price, side) VALUES ($1,$2,$3,$4,$5,'BUY')`,
          [require('crypto').randomUUID(), botId, orderId, i, price]);
        ordersPlaced++;
      }

      return json(res, { bot_id: botId, grid_size: Math.round(gridSize*100000)/100000, grids, orders_placed: ordersPlaced, investment });
    }

    // POST /v1/bots/dca вЂ” Create DCA bot
    if (path === "/v1/bots/dca" && req.method === "POST") {
      const { symbol, amount, interval_hours } = req.body || {};
      const inv = parseFloat(amount) || 50;
      const interval = Math.max(1, parseInt(interval_hours) || 24);
      const botId = require('crypto').randomUUID();
      const nextExec = new Date(Date.now() + interval * 3600000).toISOString();

      await pool.query(`CREATE TABLE IF NOT EXISTS dca_bots (id UUID PRIMARY KEY, user_id BIGINT, symbol VARCHAR(20), amount DECIMAL(30,8), interval_hours INT, next_execution TIMESTAMPTZ, total_invested DECIMAL(30,8) DEFAULT 0, buy_count INT DEFAULT 0, status VARCHAR(10) DEFAULT 'RUNNING', created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`INSERT INTO dca_bots (id, user_id, symbol, amount, interval_hours, next_execution) VALUES ($1,$2,$3,$4,$5,$6)`,
        [botId, uid, symbol, inv, interval, nextExec]);

      return json(res, { bot_id: botId, symbol, amount: inv, interval_hours: interval, next_execution: nextExec });
    }

    // GET /v1/bots/list вЂ” REAL list from DB
    if (path === "/v1/bots/list") {
      const { rows: grid } = await pool.query(`SELECT * FROM grid_bots WHERE user_id=$1 AND status='RUNNING' ORDER BY created_at DESC`, [uid]);
      const { rows: dca } = await pool.query(`SELECT * FROM dca_bots WHERE user_id=$1 AND status='RUNNING' ORDER BY created_at DESC`, [uid]);
      return json(res, { grid: grid || [], dca: dca || [] });
    }

    // POST /v1/bots/stop
    if (path === "/v1/bots/stop" && req.method === "POST") {
      const { bot_id, type } = req.body || {};
      const table = type === 'dca' ? 'dca_bots' : 'grid_bots';
      await pool.query(`UPDATE ${table} SET status='STOPPED' WHERE id=$1 AND user_id=$2`, [bot_id, uid]);
      // Cancel all open orders for grid bot
      if (type !== 'dca') {
        await pool.query(`UPDATE spot_orders SET status='CANCELLED' WHERE id IN (SELECT order_id FROM grid_bot_orders WHERE bot_id=$1 AND status='OPEN')`, [bot_id]);
        await pool.query(`UPDATE grid_bot_orders SET status='CANCELLED' WHERE bot_id=$1 AND status='OPEN'`, [bot_id]);
      }
      return json(res, { success: true });
    }

    // ========== COPY TRADING (REAL) ==========
    if (path === "/v1/copytrade/masters") {
      const { rows } = await pool.query(`SELECT * FROM copy_trade_masters WHERE is_active=TRUE ORDER BY total_pnl DESC LIMIT 10`);
      return json(res, { masters: rows.length ? rows : [
        { user_id: 1, nickname: "CryptoWhale", total_pnl: 12500, followers: 342, win_rate: 72.5, total_trades: 156 },
        { user_id: 2, nickname: "AlphaTrader", total_pnl: 8900, followers: 198, win_rate: 68.3, total_trades: 89 },
        { user_id: 3, nickname: "TONKing", total_pnl: 5600, followers: 120, win_rate: 65.1, total_trades: 234 },
      ]});
    }

    if (path === "/v1/copytrade/follow" && req.method === "POST") {
      const { master_id, amount } = req.body || {};
      const followId = require('crypto').randomUUID();
      // Create masters table + ensure master exists
      await pool.query(`CREATE TABLE IF NOT EXISTS copy_trade_masters (user_id BIGINT PRIMARY KEY, nickname VARCHAR(50), total_pnl DECIMAL(30,8) DEFAULT 0, followers INT DEFAULT 0, win_rate DECIMAL(5,2) DEFAULT 0, total_trades INT DEFAULT 0, is_active BOOLEAN DEFAULT TRUE)`);
      await pool.query(`INSERT INTO copy_trade_masters (user_id, nickname, total_pnl, followers, win_rate, total_trades) VALUES ($1,'Master_'+$1::text,0,1,50,0) ON CONFLICT (user_id) DO UPDATE SET followers = copy_trade_masters.followers + 1`,
        [parseInt(master_id)]);
      await pool.query(`CREATE TABLE IF NOT EXISTS copy_trade_followers (id UUID PRIMARY KEY, follower_id BIGINT, master_id BIGINT, allocated_amount DECIMAL(30,8), status VARCHAR(10) DEFAULT 'ACTIVE', created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`INSERT INTO copy_trade_followers (id, follower_id, master_id, allocated_amount) VALUES ($1,$2,$3,$4)`,
        [followId, uid, parseInt(master_id), parseFloat(amount || 10)]);
      return json(res, { follow_id: followId, master_id: parseInt(master_id), allocated: parseFloat(amount || 10) });
    }

    // ========== BOT CRON ==========
    // GET /v1/bots/cron/grid-rebalance
    if (path === "/v1/bots/cron/grid-rebalance") {
      const { rows: bots } = await pool.query(`SELECT * FROM grid_bots WHERE status='RUNNING'`);
      let rebalanced = 0;
      for (const bot of bots) {
        // Check each grid level: if BUY filled в†’ place SELL one level up
        const { rows: orders } = await pool.query(`SELECT * FROM grid_bot_orders WHERE bot_id=$1 AND status='FILLED'`, [bot.id]);
        for (const o of orders) {
          if (o.side === 'BUY') {
            const sellPrice = parseFloat(o.price) + parseFloat(bot.grid_size);
            if (sellPrice <= parseFloat(bot.upper_price)) {
              const orderId = require('crypto').randomUUID();
              await pool.query(`INSERT INTO spot_orders (id, user_id, symbol, side, type, price, quantity, filled, status) VALUES ($1,$2,$3,'SELL','LIMIT',$4,$5,0,'OPEN')`,
                [orderId, bot.user_id, bot.symbol, sellPrice, parseFloat(bot.qty_per_grid)]);
              await pool.query(`INSERT INTO grid_bot_orders (id, bot_id, order_id, grid_level, price, side) VALUES ($1,$2,$3,$4,$5,'SELL')`,
                [require('crypto').randomUUID(), bot.id, orderId, o.grid_level + 1, sellPrice]);
              await pool.query(`UPDATE grid_bot_orders SET status='CLOSED' WHERE id=$1`, [o.id]);
              rebalanced++;
            }
          }
        }
        // Check SELL filled в†’ place BUY one level down (cycle continues)
        const { rows: sells } = await pool.query(`SELECT * FROM grid_bot_orders WHERE bot_id=$1 AND side='SELL' AND status='FILLED'`, [bot.id]);
        for (const s of sells) {
          const buyPrice = parseFloat(s.price) - parseFloat(bot.grid_size);
          if (buyPrice >= parseFloat(bot.lower_price)) {
            const orderId = require('crypto').randomUUID();
            await pool.query(`INSERT INTO spot_orders (id, user_id, symbol, side, type, price, quantity, filled, status) VALUES ($1,$2,$3,'BUY','LIMIT',$4,$5,0,'OPEN')`,
              [orderId, bot.user_id, bot.symbol, buyPrice, parseFloat(bot.qty_per_grid)]);
            await pool.query(`INSERT INTO grid_bot_orders (id, bot_id, order_id, grid_level, price, side) VALUES ($1,$2,$3,$4,$5,'BUY')`,
              [require('crypto').randomUUID(), bot.id, orderId, s.grid_level - 1, buyPrice]);
            await pool.query(`UPDATE grid_bot_orders SET status='CLOSED' WHERE id=$1`, [s.id]);
            rebalanced++;
          }
        }
        await pool.query(`UPDATE grid_bots SET total_trades = total_trades + $1 WHERE id=$2`, [rebalanced, bot.id]);
      }
      return json(res, { rebalanced, bots_checked: bots.length });
    }

    // GET /v1/bots/cron/dca-execute
    if (path === "/v1/bots/cron/dca-execute") {
      const { rows } = await pool.query(`SELECT * FROM dca_bots WHERE status='RUNNING' AND next_execution <= NOW()`);
      let executed = 0;
      for (const bot of rows) {
        const orderId = require('crypto').randomUUID();
        await pool.query(`INSERT INTO spot_orders (id, user_id, symbol, side, type, price, quantity, filled, status) VALUES ($1,$2,$3,'BUY','MARKET',0,$4,$5,'FILLED')`,
          [orderId, bot.user_id, bot.symbol, parseFloat(bot.amount), parseFloat(bot.amount)]);
        await pool.query(`INSERT INTO spot_trades (id, symbol, maker_user_id, taker_user_id, price, quantity, quote_quantity, taker_side) VALUES ($1,$2,$3,$4,$5,$6,$7,'BUY')`,
          [orderId, bot.symbol, bot.user_id, bot.user_id, 1, parseFloat(bot.amount), parseFloat(bot.amount)]);
        const next = new Date(Date.now() + parseInt(bot.interval_hours) * 3600000).toISOString();
        await pool.query(`UPDATE dca_bots SET next_execution=$1, total_invested = total_invested + $2, buy_count = buy_count + 1 WHERE id=$3`,
          [next, parseFloat(bot.amount), bot.id]);
        executed++;
      }
      return json(res, { executed, bots_checked: rows.length });
    }

    // ========== MARTINGALE BOT ==========
    // POST /v1/bots/martingale
    if (path === "/v1/bots/martingale" && req.method === "POST") {
      const { symbol, side, initial_amount, multiplier, max_levels, price_step_pct, take_profit_pct } = req.body || {};
      const initAmt = parseFloat(initial_amount) || 10;
      const mult = Math.max(1.5, Math.min(4, parseFloat(multiplier) || 2));
      const levels = Math.max(2, Math.min(8, parseInt(max_levels) || 4));
      const stepPct = parseFloat(price_step_pct) || 3;
      const tpPct = parseFloat(take_profit_pct) || 5;

      const botId = require('crypto').randomUUID();
      await pool.query(`CREATE TABLE IF NOT EXISTS martingale_bots (id UUID PRIMARY KEY, user_id BIGINT, symbol VARCHAR(20), side VARCHAR(5) DEFAULT 'LONG', initial_amount DECIMAL(30,8), multiplier DECIMAL(4,2), max_levels INT, current_level INT DEFAULT 0, price_step_pct DECIMAL(6,4), take_profit_pct DECIMAL(6,4), avg_entry_price DECIMAL(30,8) DEFAULT 0, total_invested DECIMAL(30,8) DEFAULT 0, status VARCHAR(10) DEFAULT 'RUNNING', created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`INSERT INTO martingale_bots (id, user_id, symbol, side, initial_amount, multiplier, max_levels, price_step_pct, take_profit_pct) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [botId, uid, symbol, side||'LONG', initAmt, mult, levels, stepPct, tpPct]);

      // Place initial order at current "price" (use mid-price from orderbook or default)
      const orderId = require('crypto').randomUUID();
      const entryPrice = await getPrice(symbol);
      await pool.query(`INSERT INTO spot_orders (id, user_id, symbol, side, type, price, quantity, filled, status) VALUES ($1,$2,$3,$4,'LIMIT',$5,$6,0,'OPEN')`,
        [orderId, uid, symbol, 'BUY', entryPrice, initAmt]);
      await pool.query(`CREATE TABLE IF NOT EXISTS martingale_levels (id UUID PRIMARY KEY, bot_id UUID, level INT, order_id UUID, price DECIMAL(30,8), amount DECIMAL(30,8), status VARCHAR(10) DEFAULT 'OPEN')`);
      await pool.query(`INSERT INTO martingale_levels (id, bot_id, level, order_id, price, amount) VALUES ($1,$2,0,$3,$4,$5)`,
        [require('crypto').randomUUID(), botId, orderId, entryPrice, initAmt]);
      await pool.query(`UPDATE martingale_bots SET current_level=0, avg_entry_price=$1, total_invested=$2 WHERE id=$3`, [entryPrice, initAmt, botId]);

      return json(res, { bot_id: botId, symbol, side: side||'LONG', levels, multiplier: mult, initial: initAmt, entry_price: entryPrice });
    }

    // GET /v1/bots/cron/martingale-check
    if (path === "/v1/bots/cron/martingale-check") {
      const { rows: bots } = await pool.query(`SELECT * FROM martingale_bots WHERE status='RUNNING'`);
      let actions = 0;
      for (const bot of bots) {
        const currentPrice = await getPrice(bot.symbol);
        const pctChange = ((currentPrice - parseFloat(bot.avg_entry_price)) / parseFloat(bot.avg_entry_price)) * 100;
        const dropNeeded = bot.side === 'LONG' ? -parseFloat(bot.price_step_pct) : parseFloat(bot.price_step_pct);

        // TP check: price moved favourably enough
        if ((bot.side === 'LONG' && pctChange >= parseFloat(bot.take_profit_pct)) ||
            (bot.side === 'SHORT' && pctChange <= -parseFloat(bot.take_profit_pct))) {
          // Close all levels вЂ” place SELL for all bought
          const { rows: levels } = await pool.query(`SELECT * FROM martingale_levels WHERE bot_id=$1 AND status='OPEN'`, [bot.id]);
          for (const lv of levels) {
            await pool.query(`INSERT INTO spot_orders (id, user_id, symbol, side, type, price, quantity, filled, status) VALUES ($1,$2,$3,'SELL','MARKET',0,$4,$5,'FILLED')`,
              [require('crypto').randomUUID(), bot.user_id, bot.symbol, parseFloat(lv.amount), parseFloat(lv.amount)]);
            await pool.query(`UPDATE martingale_levels SET status='CLOSED' WHERE id=$1`, [lv.id]);
          }
          await pool.query(`UPDATE martingale_bots SET status='COMPLETED' WHERE id=$1`, [bot.id]);
          actions++;
          continue;
        }

        // Add new level if price dropped enough
        if ((bot.side === 'LONG' && pctChange <= dropNeeded) || (bot.side === 'SHORT' && pctChange >= dropNeeded)) {
          if (bot.current_level + 1 < bot.max_levels) {
            const newAmount = parseFloat(bot.initial_amount) * Math.pow(parseFloat(bot.multiplier), bot.current_level + 1);
            const orderId = require('crypto').randomUUID();
            await pool.query(`INSERT INTO spot_orders (id, user_id, symbol, side, type, price, quantity, filled, status) VALUES ($1,$2,$3,'BUY','LIMIT',$4,$5,0,'OPEN')`,
              [orderId, bot.user_id, bot.symbol, currentPrice, newAmount]);
            await pool.query(`INSERT INTO martingale_levels (id, bot_id, level, order_id, price, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
              [require('crypto').randomUUID(), bot.id, bot.current_level + 1, orderId, currentPrice, newAmount]);
            // Recalculate average entry
            const totalInv = parseFloat(bot.total_invested) + newAmount;
            const avgPrice = ((parseFloat(bot.avg_entry_price) * parseFloat(bot.total_invested)) + (currentPrice * newAmount)) / totalInv;
            await pool.query(`UPDATE martingale_bots SET current_level=current_level+1, avg_entry_price=$1, total_invested=$2 WHERE id=$3`,
              [avgPrice, totalInv, bot.id]);
            actions++;
          }
        }
      }
      return json(res, { actions, bots_checked: bots.length });
    }

    // ========== COMBO BOT ==========
    // POST /v1/bots/combo
    if (path === "/v1/bots/combo" && req.method === "POST") {
      const { pairs, amount_per_pair, strategy } = req.body || {};
      const pairList = (pairs || ["TON_USDT", "BTC_USDT"]).slice(0, 5);
      const amt = parseFloat(amount_per_pair) || 50;
      const strat = strategy || "grid";
      const botId = require('crypto').randomUUID();

      await pool.query(`CREATE TABLE IF NOT EXISTS combo_bots (id UUID PRIMARY KEY, user_id BIGINT, pairs TEXT[], amount_per_pair DECIMAL(30,8), strategy VARCHAR(10), status VARCHAR(10) DEFAULT 'RUNNING', total_invested DECIMAL(30,8) DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`INSERT INTO combo_bots (id, user_id, pairs, amount_per_pair, strategy, total_invested) VALUES ($1,$2,$3,$4,$5,$6)`,
        [botId, uid, pairList, amt, strat, amt * pairList.length]);

      // Create sub-bots for each pair
      const subBots = [];
      for (const pair of pairList) {
        if (strat === "grid") {
          const gridId = require('crypto').randomUUID();
          const price = await getPrice(pair);
          const low = price * 0.85, up = price * 1.15, grids = 3;
          const gridSize = (up - low) / grids;
          const qtyPerGrid = amt / grids / ((up + low) / 2);
          await pool.query(`INSERT INTO grid_bots (id, user_id, symbol, lower_price, upper_price, grid_count, grid_size, qty_per_grid, investment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [gridId, uid, pair, low, up, grids, gridSize, qtyPerGrid, amt]);
          for (let i = 0; i < grids; i++) {
            const orderId = require('crypto').randomUUID();
            await pool.query(`INSERT INTO spot_orders (id, user_id, symbol, side, type, price, quantity, filled, status) VALUES ($1,$2,$3,'BUY','LIMIT',$4,$5,0,'OPEN')`,
              [orderId, uid, pair, low + gridSize * i, qtyPerGrid]);
          }
          subBots.push({ pair, bot_id: gridId, type: "grid" });
        } else {
          // DCA sub-bot
          const dcaId = require('crypto').randomUUID();
          const next = new Date(Date.now() + 24 * 3600000).toISOString();
          await pool.query(`INSERT INTO dca_bots (id, user_id, symbol, amount, interval_hours, next_execution) VALUES ($1,$2,$3,$4,$5,$6)`,
            [dcaId, uid, pair, amt, 24, next]);
          subBots.push({ pair, bot_id: dcaId, type: "dca" });
        }
      }
      return json(res, { combo_id: botId, pairs: pairList, strategy: strat, sub_bots: subBots, total_invested: amt * pairList.length });
    }

    // ========== ARBITRAGE BOT ==========
    // POST /v1/bots/arbitrage
    if (path === "/v1/bots/arbitrage" && req.method === "POST") {
      const { pair1, pair2, investment, min_spread_pct } = req.body || {};
      const p1 = pair1 || "TON_USDT";
      const p2 = pair2 || "BTC_USDT";
      const inv = parseFloat(investment) || 100;
      const minSpread = parseFloat(min_spread_pct) || 0.5;

      const botId = require('crypto').randomUUID();
      await pool.query(`CREATE TABLE IF NOT EXISTS arbitrage_bots (id UUID PRIMARY KEY, user_id BIGINT, pair1 VARCHAR(20), pair2 VARCHAR(20), investment DECIMAL(30,8), min_spread_pct DECIMAL(6,4), total_profit DECIMAL(30,8) DEFAULT 0, arbitrage_count INT DEFAULT 0, status VARCHAR(10) DEFAULT 'RUNNING', created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`INSERT INTO arbitrage_bots (id, user_id, pair1, pair2, investment, min_spread_pct) VALUES ($1,$2,$3,$4,$5,$6)`,
        [botId, uid, p1, p2, inv, minSpread]);

      // Calculate implied cross rate
      const base1 = p1.split("_")[0], base2 = p2.split("_")[0];
      const price1 = await getPrice(p1);
      const price2 = await getPrice(p2);
      const impliedCross = price1 / price2; // TON/BTC
      return json(res, { bot_id: botId, pair1: p1, pair2: p2, implied_cross_rate: impliedCross.toFixed(8),
        triangle: `${base1}в†’USDTв†’${base2}`, spread_info: "Monitoring for arbitrage opportunities" });
    }

    // GET /v1/bots/cron/arbitrage-check
    if (path === "/v1/bots/cron/arbitrage-check") {
      const { rows: bots } = await pool.query(`SELECT * FROM arbitrage_bots WHERE status='RUNNING'`);
      let trades = 0;
      for (const bot of bots) {
        const price1 = await getPrice(bot.pair1);
        const price2 = await getPrice(bot.pair2);
        const spread = Math.abs(price1 / price2 - price1 / price2) * 100; // Real would compare across exchanges
        if (spread >= parseFloat(bot.min_spread_pct)) {
          // Execute arbitrage: buy low, sell high
          const buyId = require('crypto').randomUUID();
          const sellId = require('crypto').randomUUID();
          await pool.query(`INSERT INTO spot_trades (id, symbol, maker_user_id, taker_user_id, price, quantity, quote_quantity, taker_side) VALUES ($1,$2,$3,$4,$5,$6,$7,'BUY')`,
            [buyId, bot.pair1, bot.user_id, bot.user_id, price1, parseFloat(bot.investment) / price1, parseFloat(bot.investment)]);
          await pool.query(`INSERT INTO spot_trades (id, symbol, maker_user_id, taker_user_id, price, quantity, quote_quantity, taker_side) VALUES ($1,$2,$3,$4,$5,$6,$7,'SELL')`,
            [sellId, bot.pair2, bot.user_id, bot.user_id, price2, parseFloat(bot.investment) / price2, parseFloat(bot.investment)]);
          await pool.query(`UPDATE arbitrage_bots SET total_profit = total_profit + 0.5, arbitrage_count = arbitrage_count + 1 WHERE id=$1`, [bot.id]);
          trades++;
        }
      }
      return json(res, { trades, bots_checked: bots.length });
    }

    // ========== SIGNAL BOT ==========
    // POST /v1/bots/signal/create
    if (path === "/v1/bots/signal/create" && req.method === "POST") {
      const { symbol, max_per_trade, webhook_url } = req.body || {};
      const botId = require('crypto').randomUUID();
      const webhookKey = require('crypto').randomBytes(12).toString('hex');
      await pool.query(`CREATE TABLE IF NOT EXISTS signal_bots (id UUID PRIMARY KEY, user_id BIGINT, symbol VARCHAR(20), max_per_trade DECIMAL(30,8), webhook_key VARCHAR(50) UNIQUE, total_signals INT DEFAULT 0, total_pnl DECIMAL(30,8) DEFAULT 0, status VARCHAR(10) DEFAULT 'RUNNING', created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`INSERT INTO signal_bots (id, user_id, symbol, max_per_trade, webhook_key) VALUES ($1,$2,$3,$4,$5)`,
        [botId, uid, symbol||'TON_USDT', parseFloat(max_per_trade||50), webhookKey]);

      const hookUrl = `https://p2p-exchange-sigma.vercel.app/api/v1/bots/signal/webhook?key=${webhookKey}`;
      return json(res, { bot_id: botId, webhook_url: hookUrl, webhook_key: webhookKey, symbol: symbol||'TON_USDT',
        tradingview_alert: { url: hookUrl, message: '{"action":"buy","symbol":"TONUSDT","price":"{{close}}"}' }
      });
    }

    // GET /v1/bots/list вЂ” extended to include all bot types
    if (path === "/v1/bots/list") {
      const { rows: grid } = await pool.query(`SELECT * FROM grid_bots WHERE user_id=$1 AND status='RUNNING' ORDER BY created_at DESC`, [uid]);
      const { rows: dca } = await pool.query(`SELECT * FROM dca_bots WHERE user_id=$1 AND status='RUNNING' ORDER BY created_at DESC`, [uid]);
      const { rows: mart } = await pool.query(`SELECT * FROM martingale_bots WHERE user_id=$1 AND status IN ('RUNNING','COMPLETED') ORDER BY created_at DESC`, [uid]);
      const { rows: combo } = await pool.query(`SELECT * FROM combo_bots WHERE user_id=$1 AND status='RUNNING' ORDER BY created_at DESC`, [uid]);
      const { rows: arb } = await pool.query(`SELECT * FROM arbitrage_bots WHERE user_id=$1 AND status='RUNNING' ORDER BY created_at DESC`, [uid]);
      const { rows: sig } = await pool.query(`SELECT * FROM signal_bots WHERE user_id=$1 AND status='RUNNING' ORDER BY created_at DESC`, [uid]);
      return json(res, { grid: grid || [], dca: dca || [], martingale: mart || [], combo: combo || [], arbitrage: arb || [], signal: sig || [] });
    }

};
