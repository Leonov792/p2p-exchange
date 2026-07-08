// Exchange v2 — Binance-clone trading integrated into P2P Mini App
// API: https://backend-six-chi-80.vercel.app/api (Node.js)
'use strict';

const API_V2 = '/api';
const API_LEGACY = '/api';

function uid() {
    let id = localStorage.getItem('p2p_user_id');
    if (!id) { id = String(Math.floor(Math.random() * 900000) + 100000); localStorage.setItem('p2p_user_id', id); }
    return id;
}

function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.initData) {
        headers['X-Telegram-InitData'] = tg.initData;
    }
    // Also send user ID for backend identification
    headers['X-Telegram-User-Id'] = String(uid());
    return headers;
}

// ========================= SPOT TRADING =========================

const spotPairs = [
    'BTC_USDT','ETH_USDT','TON_USDT','SOL_USDT','DOGE_USDT','XRP_USDT','ADA_USDT',
    'NOT_USDT','PEPE_USDT','SHIB_USDT','AVAX_USDT','DOT_USDT','LINK_USDT',
    'MATIC_USDT','UNI_USDT','LTC_USDT','BCH_USDT','ATOM_USDT','NEAR_USDT',
    'APT_USDT','SUI_USDT','FIL_USDT','ARB_USDT','OP_USDT',
];

let currentSpotSymbol = 'TON_USDT';
let chart = null;
let candleSeries = null;
let volumeSeries = null;

async function initChart() {
    const container = document.getElementById('tvChart');
    if (!container || !window.LightweightCharts) return;

    if (chart) { chart.remove(); chart = null; }

    chart = window.LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 350,
        layout: { background: { type: 'solid', color: '#0d1117' }, textColor: '#8b949e' },
        grid: { vertLines: { color: '#1e2329' }, horzLines: { color: '#1e2329' } },
        crosshair: { mode: 0 },
        timeScale: { borderColor: '#30363d', timeVisible: true },
        rightPriceScale: { borderColor: '#30363d' },
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: '#0ecb81', downColor: '#f6465d', borderDownColor: '#f6465d',
        borderUpColor: '#0ecb81', wickDownColor: '#f6465d', wickUpColor: '#0ecb81',
    });

    volumeSeries = chart.addHistogramSeries({
        color: '#26a69a20', priceFormat: { type: 'volume' },
        priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    await loadChartData(currentSpotSymbol);
    setInterval(function() { loadChartData(currentSpotSymbol); }, 30000);
}

async function loadChartData(symbol) {
    if (!candleSeries) return;
    try {
        const r = await fetch(`/api/v1/klines?symbol=${symbol}&interval=1h&limit=200`).then(r => r.json());
        if (r.klines && r.klines.length) {
            candleSeries.setData(r.klines);
            volumeSeries.setData(r.klines.map(function(k) { return { time: k.time, value: k.volume, color: k.close >= k.open ? '#0ecb8120' : '#f6465d20' }; }));
        }
    } catch(e) {}
}

function initSpotTab() {
    const pairsEl = document.getElementById('spotPairs');
    if (!pairsEl) return;
    pairsEl.innerHTML = spotPairs.map(p => `<option value="${p}">${p.replace('_','/')}</option>`).join('');
    pairsEl.value = currentSpotSymbol;
    pairsEl.onchange = function() {
        currentSpotSymbol = this.value;
        loadOrderBook();
        loadTicker();
        loadChartData(currentSpotSymbol);
    };
    initChart();
    loadOrderBook();
    loadTicker();
    setInterval(loadOrderBook, 5000);
    setInterval(loadTicker, 10000);
}

async function loadOrderBook() {
    try {
        const r = await fetch(`${API_V2}/v1/orderbook?symbol=${currentSpotSymbol}&depth=10`).then(r => r.json());
        if (!r.bids && !r.asks) return;
        renderOrderBook(r);
    } catch(e) {}
}

function renderOrderBook(data) {
    const container = document.getElementById('spotOrderBook');
    if (!container) return;
    let html = '<table class="ob-table"><thead><tr><th>Price</th><th>Amount</th><th>Total</th></tr></thead><tbody>';

    const asks = (data.asks || []).reverse();
    for (const l of asks) {
        const p = parseFloat(l.price), q = parseFloat(l.quantity), t = p * q;
        html += `<tr class="ask-row"><td style="color:var(--red)">${p.toFixed(l.price.length > 10 ? 6 : 4)}</td><td>${q.toFixed(4)}</td><td>${t.toFixed(2)}</td></tr>`;
    }

    for (const l of (data.bids || [])) {
        const p = parseFloat(l.price), q = parseFloat(l.quantity), t = p * q;
        html += `<tr class="bid-row"><td style="color:var(--green)">${p.toFixed(l.price.length > 10 ? 6 : 4)}</td><td>${q.toFixed(4)}</td><td>${t.toFixed(2)}</td></tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

async function loadTicker() {
    try {
        const r = await fetch(`${API_V2}/v1/ticker?symbol=${currentSpotSymbol}`).then(r => r.json());
        const el = document.getElementById('spotTicker');
        if (!el) return;
        if (r.last_price) {
            const change = parseFloat(r.price_change_pct || 0);
            const clr = change >= 0 ? 'var(--green)' : 'var(--red)';
            el.innerHTML = `<span style="font-size:22px;font-weight:700;color:${clr}">${r.last_price}</span>
                <span style="font-size:13px;margin-left:8px;color:${clr}">${change>=0?'+':''}${change.toFixed(2)}%</span>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
                    H: ${r.high_24h||'--'} L: ${r.low_24h||'--'} Vol: ${Number(r.volume_24h||0).toFixed(2)}
                </div>`;
        }
    } catch(e) {}
}

async function placeSpotOrder() {
    const side = document.getElementById('spotSide')?.classList.contains('side-active-green') ? 'BUY' : 'SELL';
    const type = document.getElementById('spotOrderType')?.value || 'LIMIT';
    const price = document.getElementById('spotPrice')?.value || '';
    const qty = document.getElementById('spotQty')?.value || '';
    if (!qty) { toast('Enter quantity'); return; }

    const body = { symbol: currentSpotSymbol, side, type, quantity: qty, time_in_force: 'GTC' };
    if (type === 'LIMIT') body.price = price;

    try {
        const r = await fetch(`${API_V2}/v1/orders/place`, {
            method: 'POST', headers: authHeaders(), body: JSON.stringify(body)
        }).then(r => r.json());
        if (r.order_id) {
            toast(`${side} order placed: ${r.order_id.slice(0,8)}`);
            loadOrderBook();
        } else {
            toast('Error: ' + (r.error || 'unknown'));
        }
    } catch(e) { toast('Order failed: ' + e.message); }
}

function toggleSpotSide(side) {
    const buyBtn = document.getElementById('spotBuyBtn');
    const sellBtn = document.getElementById('spotSellBtn');
    if (!buyBtn || !sellBtn) return;
    buyBtn.classList.toggle('side-active-green', side === 'BUY');
    sellBtn.classList.toggle('side-active-red', side === 'SELL');
    document.getElementById('spotSide').classList.remove('side-active-green', 'side-active-red');
    document.getElementById('spotSide').classList.add(side === 'BUY' ? 'side-active-green' : 'side-active-red');
}

// ========================= FUTURES =========================

async function loadFuturesPositions() {
    try {
        const r = await fetch(`${API_V2}/v1/futures/positions?user_id=${uid()}`, {
            headers: authHeaders()
        }).then(r => r.json());
        renderPositions(r.positions || []);
    } catch(e) {}
}

function renderPositions(positions) {
    const el = document.getElementById('futuresPositions');
    if (!el) return;
    if (!positions.length) { el.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">No open positions</p>'; return; }
    el.innerHTML = positions.map(p => {
        const pnl = parseFloat(p.unrealized_pnl || 0);
        const pnlClr = pnl >= 0 ? 'var(--green)' : 'var(--red)';
        return `<div class="pos-card" style="border-left:3px solid ${p.side==='LONG'?'var(--green)':'var(--red)'}">
            <div><strong>${p.side}</strong> ${(p.symbol||'').replace('_PERP','')} ${p.leverage}x</div>
            <div style="font-size:12px;color:var(--text-muted)">Size: ${Number(p.quantity||0).toFixed(4)} | Entry: ${Number(p.entry_price||0).toFixed(2)}</div>
            <div style="font-size:12px">Mark: ${Number(p.mark_price||0).toFixed(4)} | Liq: ${Number(p.liquidation_price||0).toFixed(4)}</div>
            <div style="color:${pnlClr};font-weight:600">PnL: ${pnl.toFixed(4)} USDT</div>
            <button class="btn btn-red" style="margin-top:6px;font-size:11px;padding:4px 12px" onclick="closePosition('${p.id}')">Close</button>
        </div>`;
    }).join('');
}

async function openFuturesPosition() {
    const side = document.getElementById('futSide')?.classList.contains('side-active-green') ? 'LONG' : 'SHORT';
    const symbol = document.getElementById('futSymbol')?.value || 'BTC_USDT_PERP';
    const leverage = parseInt(document.getElementById('futLeverage')?.value || '10');
    const qty = document.getElementById('futQty')?.value || '';
    if (!qty) { toast('Enter quantity'); return; }

    try {
        const r = await fetch(`${API_V2}/v1/futures/position/open`, {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ symbol, side, quantity: qty, leverage, margin_type: 'ISOLATED', order_type: 'MARKET' })
        }).then(r => r.json());
        if (r.id) {
            toast(`${side} ${leverage}x opened`);
            loadFuturesPositions();
        } else {
            toast('Error: ' + (r.error || ''));
        }
    } catch(e) { toast('Position failed'); }
}

async function closePosition(posId) {
    try {
        const r = await fetch(`${API_V2}/v1/futures/position/close`, {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ position_id: posId })
        }).then(r => r.json());
        if (r.success) {
            toast('Closed! PnL: ' + parseFloat(r.realized_pnl||0).toFixed(4));
            loadFuturesPositions();
        }
    } catch(e) {}
}

function toggleFutSide(side) {
    ['futLongBtn','futShortBtn'].forEach(id => {
        const b = document.getElementById(id);
        if (!b) return;
        b.classList.toggle('side-active-green', id === 'futLongBtn' && side === 'LONG');
        b.classList.toggle('side-active-red', id === 'futShortBtn' && side === 'SHORT');
    });
}

// ========================= EARN / STAKING =========================

function loadEarnProducts() {
    const el = document.getElementById('earnProducts');
    if (!el) return;
    const products = [
        { name: 'USDT Flexible', type: 'Flexible', apr: '5.00%', lock: 'Redeem anytime' },
        { name: 'USDT 30-Day', type: 'Locked', apr: '8.00%', lock: '30 days' },
        { name: 'TON Flexible', type: 'Flexible', apr: '4.00%', lock: 'Redeem anytime' },
        { name: 'TON 60-Day', type: 'Locked', apr: '10.00%', lock: '60 days' },
    ];
    el.innerHTML = products.map(p => `<div class="earn-card">
        <div><strong>${p.name}</strong></div>
        <div style="font-size:12px;color:var(--text-muted)">${p.type} · ${p.lock}</div>
        <div style="font-size:20px;font-weight:700;color:var(--green);margin-top:4px">${p.apr}</div>
        <button class="btn btn-primary" style="margin-top:6px;font-size:12px;padding:4px 12px" onclick="stakeProduct('${p.name}')">Stake</button>
    </div>`).join('');
}

function stakeProduct(name) {
    const amount = prompt(`Stake amount for ${name}:`);
    if (!amount) return;
    fetch(`${API_V2}/v1/earn/stake`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ user_id: parseInt(uid()), product_id: 1, amount, auto_compound: false })
    }).then(r => r.json()).then(d => {
        toast(d.position_id ? `Staked ${amount}` : 'Stake failed');
    }).catch(() => toast('Stake error'));
}

// ========================= TAB INIT =========================
function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    setTimeout(function() { t.classList.remove('show'); }, 3500);
}

// P2P sub-tab toggle
window.toggleP2PSide = function(side) {
    document.getElementById('p2pBuyBtn').classList.toggle('side-active-green', side === 'buy');
    document.getElementById('p2pSellBtn').classList.toggle('side-active-green', side === 'sell');
    document.getElementById('p2pBuySection').style.display = side === 'buy' ? 'block' : 'none';
    document.getElementById('p2pSellSection').style.display = side === 'sell' ? 'block' : 'none';
};

// ========================= OPTIONS =========================
async function loadOptionChain() {
    const symbol = document.getElementById('optSymbol')?.value || 'BTC_USDT';
    try {
        const r = await fetch(`${API_V2}/v1/options/chain?symbol=${symbol}`).then(r => r.json());
        const el = document.getElementById('optionChain');
        if (!el || !r.contracts) return;
        el.innerHTML = r.contracts.map(c => `<div class="card" style="text-align:center;padding:12px">
            <div style="font-size:12px;color:var(--text-muted)">${c.type}</div>
            <div style="font-weight:700;font-size:16px;color:${c.type==='CALL'?'var(--green)':'var(--red)'}">$${c.strike_price}</div>
            <div style="font-size:12px">Premium: $${c.premium}</div>
            <button class="btn btn-primary" style="margin-top:6px;font-size:11px;padding:4px 10px" onclick="tradeOption('${c.id}','${c.type}')">Trade</button>
        </div>`).join('');
    } catch(e) { /* empty */ }
}

function toggleOptionMode(mode) {
    document.getElementById('optCallBtn').classList.toggle('side-active-green', mode==='call');
    document.getElementById('optPutBtn').classList.toggle('side-active-green', mode==='put');
    document.getElementById('optPutBtn').classList.toggle('side-active-red', mode==='put');
}

function tradeOption(id, type) {
    const qty = prompt('Quantity (contracts):', '1');
    if (!qty) return;
    fetch(`${API_V2}/v1/options/trade`, { method:'POST', headers:authHeaders(), body:JSON.stringify({contract_id:id,type:type==='CALL'?'BUY':'SELL',quantity:parseInt(qty)}) })
        .then(r=>r.json()).then(d=>toast(d.trade_id?'Option traded':'Failed')).catch(()=>toast('Error'));
}
window.tradeOption = tradeOption;
window.toggleOptionMode = toggleOptionMode;
window.loadOptionChain = loadOptionChain;

// ========================= BOTS =========================
function showGridForm() {
    const el = document.getElementById('botForm');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `<div class="card">
        <h4>Grid Bot</h4>
        <select id="gridSymbol" class="select" style="margin-bottom:6px">
            <option value="TON_USDT">TON/USDT</option><option value="BTC_USDT">BTC/USDT</option><option value="ETH_USDT">ETH/USDT</option>
        </select>
        <input type="text" id="gridLower" class="input" placeholder="Lower price" style="margin-bottom:6px">
        <input type="text" id="gridUpper" class="input" placeholder="Upper price" style="margin-bottom:6px">
        <input type="text" id="gridCount" class="input" placeholder="Grid count" value="10" style="margin-bottom:6px">
        <input type="text" id="gridAmount" class="input" placeholder="Investment (USDT)" style="margin-bottom:8px">
        <button class="btn btn-primary btn-block" onclick="createGridBot()">Start Grid Bot</button>
    </div>`;
}

function showDCAForm() {
    const el = document.getElementById('botForm');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `<div class="card">
        <h4>DCA Bot</h4>
        <select id="dcaSymbol" class="select" style="margin-bottom:6px">
            <option value="TON_USDT">TON/USDT</option><option value="BTC_USDT">BTC/USDT</option>
        </select>
        <input type="text" id="dcaAmount" class="input" placeholder="Amount per buy (USDT)" style="margin-bottom:6px">
        <input type="text" id="dcaInterval" class="input" placeholder="Interval (hours)" value="24" style="margin-bottom:8px">
        <button class="btn btn-primary btn-block" onclick="createDCABot()">Start DCA Bot</button>
    </div>`;
}

async function createGridBot() {
    const body = {
        symbol: document.getElementById('gridSymbol')?.value || 'TON_USDT',
        lower: document.getElementById('gridLower')?.value || '5',
        upper: document.getElementById('gridUpper')?.value || '10',
        gridCount: document.getElementById('gridCount')?.value || '10',
        amount: document.getElementById('gridAmount')?.value || '100',
    };
    try {
        const r = await fetch(`${API_V2}/v1/bots/grid`, { method:'POST', headers:authHeaders(), body:JSON.stringify(body) }).then(r=>r.json());
        toast(r.bot_id ? `Grid bot created: ${r.grids} grids` : 'Failed');
    } catch(e) { toast('Error'); }
}

async function createDCABot() {
    try {
        const r = await fetch(`${API_V2}/v1/bots/dca`, { method:'POST', headers:authHeaders(), body:JSON.stringify({
            symbol: document.getElementById('dcaSymbol')?.value || 'TON_USDT',
            amount: document.getElementById('dcaAmount')?.value || '50',
            interval_hours: document.getElementById('dcaInterval')?.value || '24',
        })}).then(r=>r.json());
        toast(r.bot_id ? 'DCA bot started' : 'Failed');
    } catch(e) { toast('Error'); }
}

async function loadCopyTradeMasters() {
    const el = document.getElementById('copyTradeMasters');
    if (!el) return;
    try {
        const r = await fetch(`${API_V2}/v1/copytrade/masters`, { headers:authHeaders() }).then(r=>r.json());
        el.innerHTML = '<h4 style="margin-top:12px">Master Traders</h4>' + (r.masters||[]).map(m => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
            <div><strong>${m.nickname}</strong><div style="font-size:12px;color:var(--text-muted)">PnL: $${m.total_pnl} | WR: ${m.win_rate}% | ${m.followers} followers</div></div>
            <button class="btn btn-green" style="font-size:11px;padding:4px 10px" onclick="followMaster(${m.user_id})">Follow $10</button>
        </div>`).join('');
    } catch(e) {}
}

async function followMaster(masterId) {
    try {
        const r = await fetch(`${API_V2}/v1/copytrade/follow`, { method:'POST', headers:authHeaders(), body:JSON.stringify({master_id:masterId,amount:10}) }).then(r=>r.json());
        toast('Following master trader — orders will be mirrored');
    } catch(e) { toast('Error'); }
}

async function loadMyBots() {
    const el = document.getElementById('myBots');
    if (!el) return;
    try {
        const r = await fetch(`${API_V2}/v1/bots/list`, { headers:authHeaders() }).then(r=>r.json());
        let html = '';

        const addSection = (title, items, renderFn) => {
            if (!items || !items.length) return;
            html += `<h4 style="margin-top:12px;margin-bottom:6px">${title}</h4>`;
            html += items.map(renderFn).join('');
        };

        addSection('Grid Bots', r.grid, b => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
            <div><strong>${(b.symbol||'').replace('_','/')}</strong> Grid ${b.grid_count||0} levels
                <div style="font-size:11px;color:var(--text-muted)">${Number(b.lower_price).toFixed(4)} - ${Number(b.upper_price).toFixed(4)} | $${Number(b.investment).toFixed(2)}</div></div>
            <button class="btn btn-red" style="font-size:11px;padding:4px 8px" onclick="stopBot('${b.id}','grid')">Stop</button></div>`);

        addSection('DCA Bots', r.dca, b => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
            <div><strong>${(b.symbol||'').replace('_','/')}</strong> DCA $${b.amount}/h
                <div style="font-size:11px;color:var(--text-muted)">Bought: ${b.buy_count||0}x | Next: ${new Date(b.next_execution).toLocaleString()}</div></div>
            <button class="btn btn-red" style="font-size:11px;padding:4px 8px" onclick="stopBot('${b.id}','dca')">Stop</button></div>`);

        addSection('Martingale Bots', r.martingale, b => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
            <div><strong>${(b.symbol||'').replace('_','/')}</strong> ${b.side} ${b.multiplier}x
                <div style="font-size:11px;color:var(--text-muted)">Levels: ${b.current_level}/${b.max_levels} | Invested: $${Number(b.total_invested).toFixed(2)} | Avg: ${Number(b.avg_entry_price).toFixed(4)}</div></div>
            <span style="color:${b.status==='COMPLETED'?'var(--green)':'var(--yellow)'}">${b.status}</span></div>`);

        addSection('Combo Bots', r.combo, b => `<div class="card">
            <div><strong>Combo</strong> ${b.strategy} · ${(b.pairs||[]).length} pairs
                <div style="font-size:11px;color:var(--text-muted)">${(b.pairs||[]).join(', ')} | $${Number(b.total_invested).toFixed(2)}</div></div></div>`);

        addSection('Arbitrage Bots', r.arbitrage, b => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
            <div><strong>${b.pair1}/${b.pair2}</strong> Arb
                <div style="font-size:11px;color:var(--text-muted)">Trades: ${b.arbitrage_count||0} | Profit: $${Number(b.total_profit).toFixed(2)}</div></div>
            <button class="btn btn-red" style="font-size:11px;padding:4px 8px" onclick="stopBot('${b.id}','arbitrage')">Stop</button></div>`);

        addSection('Signal Bots', r.signal, b => `<div class="card">
            <div><strong>${(b.symbol||'').replace('_','/')}</strong> Signal
                <div style="font-size:11px;color:var(--text-muted)">Signals: ${b.total_signals||0} | Max: $${b.max_per_trade}</div></div></div>`);

        if (!html) html = '<p style="color:var(--text-muted);text-align:center;padding:10px">No active bots</p>';
        el.innerHTML = html;
    } catch(e) { /* empty */ }
}

async function stopBot(botId, type) {
    try {
        const r = await fetch(`${API_V2}/v1/bots/stop`, { method:'POST', headers:authHeaders(), body:JSON.stringify({bot_id:botId,type}) }).then(r=>r.json());
        if (r.success) { toast('Bot stopped'); loadMyBots(); }
    } catch(e) { toast('Error'); }
}

window.showGridForm = showGridForm;
window.showDCAForm = showDCAForm;
window.createGridBot = createGridBot;
window.createDCABot = createDCABot;
window.loadCopyTradeMasters = loadCopyTradeMasters;
window.followMaster = followMaster;
window.stopBot = stopBot;
window.loadMyBots = loadMyBots;

// ========================= MARTINGALE FORM =========================
function showMartingaleForm() {
    const el = document.getElementById('botForm');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `<div class="card">
        <h4>Martingale Bot</h4>
        <select id="martSymbol" class="select" style="margin-bottom:6px">
            <option value="TON_USDT">TON/USDT</option><option value="BTC_USDT">BTC/USDT</option>
        </select>
        <select id="martSide" class="select" style="margin-bottom:6px"><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select>
        <input type="text" id="martAmount" class="input" placeholder="Initial amount (USDT)" value="10" style="margin-bottom:6px">
        <input type="text" id="martMultiplier" class="input" placeholder="Multiplier (e.g. 2x)" value="2" style="margin-bottom:6px">
        <input type="text" id="martLevels" class="input" placeholder="Max levels" value="4" style="margin-bottom:6px">
        <input type="text" id="martStep" class="input" placeholder="Price drop % to trigger" value="3" style="margin-bottom:6px">
        <input type="text" id="martTP" class="input" placeholder="Take profit %" value="5" style="margin-bottom:8px">
        <button class="btn btn-primary btn-block" onclick="createMartingaleBot()">Start Martingale Bot</button>
    </div>`;
}

async function createMartingaleBot() {
    const body = {
        symbol: document.getElementById('martSymbol')?.value || 'TON_USDT',
        side: document.getElementById('martSide')?.value || 'LONG',
        initial_amount: document.getElementById('martAmount')?.value || '10',
        multiplier: document.getElementById('martMultiplier')?.value || '2',
        max_levels: document.getElementById('martLevels')?.value || '4',
        price_step_pct: document.getElementById('martStep')?.value || '3',
        take_profit_pct: document.getElementById('martTP')?.value || '5',
    };
    try {
        const r = await fetch(`${API_V2}/v1/bots/martingale`, { method:'POST', headers:authHeaders(), body:JSON.stringify(body) }).then(r=>r.json());
        toast(r.bot_id ? `Martingale: ${r.levels} levels, ${r.multiplier}x` : 'Failed');
        loadMyBots();
    } catch(e) { toast('Error'); }
}
window.showMartingaleForm = showMartingaleForm;
window.createMartingaleBot = createMartingaleBot;

// ========================= COMBO FORM =========================
function showComboForm() {
    const el = document.getElementById('botForm');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `<div class="card">
        <h4>Combo Bot</h4>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Trade multiple pairs at once</p>
        <input type="text" id="comboPairs" class="input" placeholder="Pairs (comma separated)" value="TON_USDT,BTC_USDT,ETH_USDT" style="margin-bottom:6px">
        <input type="text" id="comboAmount" class="input" placeholder="Amount per pair (USDT)" value="50" style="margin-bottom:6px">
        <select id="comboStrategy" class="select" style="margin-bottom:8px"><option value="grid">Grid</option><option value="dca">DCA</option></select>
        <button class="btn btn-primary btn-block" onclick="createComboBot()">Start Combo Bot</button>
    </div>`;
}

async function createComboBot() {
    const pairs = (document.getElementById('comboPairs')?.value || 'TON_USDT,BTC_USDT').split(',').map(p=>p.trim());
    const body = {
        pairs,
        amount_per_pair: document.getElementById('comboAmount')?.value || '50',
        strategy: document.getElementById('comboStrategy')?.value || 'grid',
    };
    try {
        const r = await fetch(`${API_V2}/v1/bots/combo`, { method:'POST', headers:authHeaders(), body:JSON.stringify(body) }).then(r=>r.json());
        toast(r.combo_id ? `Combo: ${r.sub_bots.length} pairs, ${r.strategy}` : 'Failed');
        loadMyBots();
    } catch(e) { toast('Error'); }
}
window.showComboForm = showComboForm;
window.createComboBot = createComboBot;

// ========================= ARBITRAGE FORM =========================
function showArbitrageForm() {
    const el = document.getElementById('botForm');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `<div class="card">
        <h4>Arbitrage Bot</h4>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Exploit cross-pair price differences</p>
        <select id="arbPair1" class="select" style="margin-bottom:4px"><option value="TON_USDT">TON/USDT</option><option value="BTC_USDT">BTC/USDT</option></select>
        <select id="arbPair2" class="select" style="margin-bottom:6px"><option value="BTC_USDT">BTC/USDT</option><option value="TON_USDT">TON/USDT</option></select>
        <input type="text" id="arbAmount" class="input" placeholder="Investment (USDT)" value="100" style="margin-bottom:6px">
        <input type="text" id="arbSpread" class="input" placeholder="Min spread %" value="0.5" style="margin-bottom:8px">
        <button class="btn btn-primary btn-block" onclick="createArbitrageBot()">Start Arbitrage Bot</button>
    </div>`;
}

async function createArbitrageBot() {
    const body = {
        pair1: document.getElementById('arbPair1')?.value || 'TON_USDT',
        pair2: document.getElementById('arbPair2')?.value || 'BTC_USDT',
        investment: document.getElementById('arbAmount')?.value || '100',
        min_spread_pct: document.getElementById('arbSpread')?.value || '0.5',
    };
    try {
        const r = await fetch(`${API_V2}/v1/bots/arbitrage`, { method:'POST', headers:authHeaders(), body:JSON.stringify(body) }).then(r=>r.json());
        toast(r.bot_id ? `Arbitrage: ${r.triangle}` : 'Failed');
        loadMyBots();
    } catch(e) { toast('Error'); }
}
window.showArbitrageForm = showArbitrageForm;
window.createArbitrageBot = createArbitrageBot;

// ========================= SIGNAL FORM =========================
function showSignalForm() {
    const el = document.getElementById('botForm');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `<div class="card">
        <h4>Signal Bot (TradingView)</h4>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Auto-trade from TradingView alerts</p>
        <select id="sigSymbol" class="select" style="margin-bottom:6px"><option value="TON_USDT">TON/USDT</option><option value="BTC_USDT">BTC/USDT</option></select>
        <input type="text" id="sigMax" class="input" placeholder="Max per trade (USDT)" value="50" style="margin-bottom:8px">
        <button class="btn btn-primary btn-block" onclick="createSignalBot()">Create Signal Bot</button>
    </div>`;
}

async function createSignalBot() {
    const body = {
        symbol: document.getElementById('sigSymbol')?.value || 'TON_USDT',
        max_per_trade: document.getElementById('sigMax')?.value || '50',
    };
    try {
        const r = await fetch(`${API_V2}/v1/bots/signal/create`, { method:'POST', headers:authHeaders(), body:JSON.stringify(body) }).then(r=>r.json());
        if (r.bot_id) {
            toast('Signal bot created!');
            el.innerHTML += `<div class="card" style="margin-top:8px">
                <strong>Webhook URL:</strong><br>
                <textarea readonly style="width:100%;font-size:11px;padding:6px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);border-radius:6px" rows="2">${r.webhook_url}</textarea>
                <p style="font-size:11px;color:var(--text-muted);margin-top:4px">Paste this in TradingView Alert → Webhook URL</p>
            </div>`;
        }
        loadMyBots();
    } catch(e) { toast('Error'); }
}
window.showSignalForm = showSignalForm;
window.createSignalBot = createSignalBot;

// ========================= UPDATED BOT LIST =========================

// ========================= LAUNCHPAD =========================
async function loadLaunchpadPools() {
    const el = document.getElementById('launchpadPools');
    if (!el) return;
    try {
        const r = await fetch(`${API_V2}/v1/launchpad/pools`, { headers:authHeaders() }).then(r=>r.json());
        el.innerHTML = (r.pools||[]).map(p => `<div class="card">
            <div style="display:flex;justify-content:space-between">
                <div><strong>${p.token_name}</strong> (${p.token_symbol})</div>
                <span style="color:${p.status==='ACTIVE'?'var(--green)':'var(--text-muted)'}">${p.status}</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">
                Stake: ${p.staking_asset} | Price: $${p.price} | Total: ${Number(p.total_allocation).toLocaleString()} ${p.token_symbol}
            </div>
            <div style="font-size:12px;color:var(--text-muted)">Ends: ${new Date(p.end_time).toLocaleDateString()}</div>
            ${p.status==='ACTIVE' ? `<button class="btn btn-primary" style="margin-top:6px;font-size:12px;padding:4px 12px" onclick="commitPool('${p.id}')">Commit USDT</button>` : ''}
        </div>`).join('');
    } catch(e) {}
}

async function commitPool(poolId) {
    const amount = prompt('USDT amount to commit:');
    if (!amount) return;
    try {
        const r = await fetch(`${API_V2}/v1/launchpad/commit`, { method:'POST', headers:authHeaders(), body:JSON.stringify({pool_id:poolId,amount}) }).then(r=>r.json());
        toast(r.success ? `Committed ${amount} USDT` : 'Failed');
    } catch(e) { toast('Error'); }
}
window.commitPool = commitPool;

// ========================= MEME LAUNCHPAD =========================
async function createMemeToken() {
    const name = document.getElementById('memeName')?.value;
    const ticker = document.getElementById('memeTicker')?.value;
    if (!name || !ticker) { toast('Enter name and ticker'); return; }
    try {
        const r = await fetch(`${API_V2}/v1/launchpad/create-token`, { method:'POST', headers:authHeaders(), body:JSON.stringify({name, ticker}) }).then(r=>r.json());
        if (r.token_id) {
            toast(`${r.ticker} created!`); loadBondingTokens();
            // Auto-buy a bit
            const amt = prompt('Buy how much USDT on bonding curve?', '50');
            if (amt) {
                const b = await fetch(`${API_V2}/v1/launchpad/buy-bonding`, { method:'POST', headers:authHeaders(), body:JSON.stringify({token_id:r.token_id, amount_usdt:amt}) }).then(r=>r.json());
                toast(b.tokens_bought ? `Bought ${b.tokens_bought} ${r.ticker} at $${Number(b.price).toFixed(6)}` : 'Buy failed');
            }
        }
    } catch(e) { toast('Create failed'); }
}

async function loadBondingTokens() {
    const el = document.getElementById('bondingTokens');
    if (!el) return;
    try {
        const r = await fetch(`${API_V2}/v1/launchpad/bonding-tokens`).then(r=>r.json());
        el.innerHTML = (r.tokens || []).map(t => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
            <div><strong>${t.ticker}</strong> · ${t.name || ''}
                <div style="font-size:11px;color:var(--text-muted)">Price: $${Number(t.current_price).toFixed(8)} · Supply: ${Number(t.total_supply).toLocaleString()}</div>
                <div style="font-size:11px;color:var(--text-muted)">Liquidity: $${Number(t.liquidity_pool).toFixed(2)}</div>
            </div>
            <button class="btn btn-green" style="font-size:11px;padding:4px 8px" onclick="buyBonding('${t.id}')">Buy</button>
        </div>`).join('') || '<p style="color:var(--text-muted);text-align:center">No tokens yet. Create one!</p>';
    } catch(e) {}
}

async function buyBonding(tokenId) {
    const amt = prompt('USDT to spend:', '25');
    if (!amt) return;
    try {
        const r = await fetch(`${API_V2}/v1/launchpad/buy-bonding`, { method:'POST', headers:authHeaders(), body:JSON.stringify({token_id:tokenId, amount_usdt:amt}) }).then(r=>r.json());
        if (r.tokens_bought) { toast(`Bought ${r.tokens_bought} at $${Number(r.price).toFixed(8)}`); loadBondingTokens(); }
        else toast(r.error || 'Failed');
    } catch(e) { toast('Error'); }
}
window.createMemeToken = createMemeToken;
window.buyBonding = buyBonding;

// ========================= TRADING DUELS =========================
async function createDuel() {
    const bet = document.getElementById('duelBet')?.value || '10';
    const symbol = document.getElementById('duelSymbol')?.value || 'TON_USDT';
    try {
        const r = await fetch(`${API_V2}/v1/duels/create`, { method:'POST', headers:authHeaders(), body:JSON.stringify({symbol, bet_amount:bet}) }).then(r=>r.json());
        if (r.duel_id) { toast('Duel created! Waiting for opponent...'); loadDuels(); }
    } catch(e) { toast('Error'); }
}

async function loadDuels() {
    const el = document.getElementById('duelsList');
    if (!el) return;
    try {
        const r = await fetch(`${API_V2}/v1/duels/list`, { headers:authHeaders() }).then(r=>r.json());
        el.innerHTML = (r.duels || []).map(d => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
            <div><strong>${d.symbol.replace('_','/')}</strong> · ${Number(d.bet_amount).toFixed(0)} USDT
                <div style="font-size:11px;color:var(--text-muted)">${d.status}</div>
            </div>
            ${d.status==='WAITING' ? `<button class="btn btn-green" style="font-size:11px;padding:4px 8px" onclick="joinDuel('${d.id}')">Join</button>` : `<span style="color:var(--text-muted)">${d.status}</span>`}
        </div>`).join('') || '<p style="color:var(--text-muted);text-align:center">No open duels</p>';
    } catch(e) {}
}

async function joinDuel(duelId) {
    try {
        const r = await fetch(`${API_V2}/v1/duels/join`, { method:'POST', headers:authHeaders(), body:JSON.stringify({duel_id:duelId}) }).then(r=>r.json());
        if (r.joined) { toast('Joined! Predict: UP or DOWN for 3 candles');
        const preds = [];
        for (let i=0;i<3;i++) { const p = prompt(`Candle ${i+1}: UP or DOWN?`, 'UP'); preds.push(p?.toLowerCase()==='up'?'up':'down'); }
        const pr = await fetch(`${API_V2}/v1/duels/predict`, { method:'POST', headers:authHeaders(), body:JSON.stringify({duel_id:duelId, predictions:preds}) }).then(r=>r.json());
        if (pr.resolved) { toast(pr.winner_id ? `Winner: ${pr.winner_id}! Prize: ${Number(pr.prize).toFixed(2)} USDT` : 'Draw!'); }
        else toast('Predictions submitted!');
    } } catch(e) { toast('Join failed'); }
}
window.createDuel = createDuel;
window.joinDuel = joinDuel;

// ========================= TAB INIT =========================
document.addEventListener('DOMContentLoaded', function() {
    var spotTab = document.querySelector('[data-tab="spot"]');
    if (spotTab) spotTab.addEventListener('click', function() { setTimeout(initSpotTab, 100); });
    if (document.getElementById('tab-spot')?.classList.contains('active')) initSpotTab();

    var futTab = document.querySelector('[data-tab="futures"]');
    if (futTab) futTab.addEventListener('click', function() { setTimeout(loadFuturesPositions, 100); });

    var earnTab = document.querySelector('[data-tab="earn"]');
    if (earnTab) earnTab.addEventListener('click', function() { setTimeout(loadEarnProducts, 100); });

    var optTab = document.querySelector('[data-tab="options"]');
    if (optTab) optTab.addEventListener('click', function() { setTimeout(loadOptionChain, 100); });

    var botTab = document.querySelector('[data-tab="bots"]');
    if (botTab) botTab.addEventListener('click', function() { setTimeout(function() { document.getElementById('botForm').style.display='none'; document.getElementById('copyTradeMasters').innerHTML=''; loadMyBots(); }, 100); });

    var padTab = document.querySelector('[data-tab="launchpad"]');
    if (padTab) padTab.addEventListener('click', function() { setTimeout(loadBondingTokens, 100); });

    var duelTab = document.querySelector('[data-tab="duels"]');
    if (duelTab) duelTab.addEventListener('click', function() { setTimeout(loadDuels, 100); });
});
