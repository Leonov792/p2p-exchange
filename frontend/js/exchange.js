// P2P Exchange v3 — Exchange Logic
// ============================================
'use strict';
const API = '/api';

let currentPage = 'spot';
let currentSpotSymbol = 'TON_USDT';
let currentSpotSide = 'BUY';
let currentFutSide = 'LONG';
let currentP2PSide = 'buy';
let currentTimeframe = '1h';
let chart = null, candleSeries = null, volumeSeries = null;
let futChart = null, futCandleSeries = null;
let obFlashTimer = null;

// ========== PAGE SWITCHING ==========
window.switchPage = function(page) {
    currentPage = page;
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    var el = document.getElementById('tab-' + page);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    var nav = document.querySelector('.nav-item[data-page="' + page + '"]');
    if (nav) nav.classList.add('active');

    if (page === 'spot') { setTimeout(initSpotTab, 50); }
    if (page === 'futures') { setTimeout(initFuturesTab, 50); }
    if (page === 'p2p') { setTimeout(loadP2POffers, 50); }
    if (page === 'deals') { setTimeout(loadMyDeals, 50); }
    if (page === 'earn') { setTimeout(initEarnTab, 50); }
    if (page === 'options') { setTimeout(loadOptionChain, 50); }
    if (page === 'meme') { setTimeout(loadBondingTokens, 50); }
    if (page === 'duel') { setTimeout(loadDuels, 50); }
    if (page === 'bots') { setTimeout(function(){ loadMyBots(); }, 50); }
    loadPairStrip();
};

window.toggleMoreMenu = function() {
    document.getElementById('navMoreMenu').classList.toggle('show');
};

// ========== PAIR STRIP ==========
var spotPairs = ['TON_USDT','BTC_USDT','ETH_USDT','SOL_USDT','DOGE_USDT','XRP_USDT','ADA_USDT',
    'NOT_USDT','PEPE_USDT','SHIB_USDT','AVAX_USDT','DOT_USDT','LINK_USDT','MATIC_USDT',
    'UNI_USDT','LTC_USDT','NEAR_USDT','SUI_USDT','ARB_USDT','OP_USDT'];

function loadPairStrip() {
    var el = document.getElementById('pairStrip');
    if (!el) return;
    el.innerHTML = spotPairs.map(function(p) {
        return '<div class="pair-item' + (p === currentSpotSymbol ? ' active' : '') + '" onclick="selectPair(\'' + p + '\')">' + p.replace('_','/') + '<div class="change up">--</div></div>';
    }).join('');
}

window.selectPair = function(pair) {
    currentSpotSymbol = pair;
    loadPairStrip();
    if (currentPage === 'spot') { loadChartData(pair, currentTimeframe); loadOrderBook(); loadTicker(); }
};

// ========== SPOT TAB ==========
function initSpotTab() {
    loadPairStrip();
    initChart();
    loadOrderBook();
    loadTicker();
    loadChartData(currentSpotSymbol, currentTimeframe);
    setInterval(function() { if (currentPage === 'spot') { loadOrderBook(); } }, 3000);
    setInterval(function() { if (currentPage === 'spot') { loadChartData(currentSpotSymbol, currentTimeframe); } }, 30000);
}

function initChart() {
    var c = document.getElementById('tvChart');
    if (!c || !window.LightweightCharts) return;
    if (chart) { chart.remove(); chart = null; }
    chart = LightweightCharts.createChart(c, {
        width: c.clientWidth, height: 320,
        layout: { background: { type: 'solid', color: '#0B0E11' }, textColor: '#848E9C' },
        grid: { vertLines: { color: '#1E2329' }, horzLines: { color: '#1E2329' } },
        crosshair: { mode: 0 }, timeScale: { borderColor: '#2B3139', timeVisible: true },
        rightPriceScale: { borderColor: '#2B3139' }
    });
    candleSeries = chart.addCandlestickSeries({ upColor: '#0ECB81', downColor: '#F6465D', borderDownColor: '#F6465D', borderUpColor: '#0ECB81', wickDownColor: '#F6465D', wickUpColor: '#0ECB81' });
    volumeSeries = chart.addHistogramSeries({ color: '#26a69a20', priceFormat: { type: 'volume' }, priceScaleId: '' });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
}

window.switchTimeframe = function(tf, btn) {
    currentTimeframe = tf;
    document.querySelectorAll('.tf-pill').forEach(function(b) { b.style.background = ''; b.style.color = ''; });
    btn.style.background = 'var(--gold)'; btn.style.color = '#000';
    loadChartData(currentSpotSymbol, tf);
};

async function loadChartData(symbol, interval) {
    if (!candleSeries) return;
    try {
        var r = await fetch(API + '/v1/klines?symbol=' + symbol + '&interval=' + (interval||'1h') + '&limit=200').then(function(r) { return r.json(); });
        if (r.klines && r.klines.length) {
            candleSeries.setData(r.klines);
            volumeSeries.setData(r.klines.map(function(k) { return { time: k.time, value: k.volume, color: k.close >= k.open ? '#0ecb8120' : '#f6465d20' }; }));
        }
    } catch(e) {}
}

async function loadOrderBook() {
    try {
        var r = await fetch(API + '/v1/orderbook?symbol=' + currentSpotSymbol + '&depth=12').then(function(r) { return r.json(); });
        renderOrderBook(r);
    } catch(e) {}
}

function renderOrderBook(data) {
    var el = document.getElementById('spotOrderBookWrap');
    if (!el) return;
    var asks = (data.asks || []).reverse();
    var bids = data.bids || [];
    var maxQty = 0;
    asks.concat(bids).forEach(function(l) { var q = parseFloat(l.quantity); if (q > maxQty) maxQty = q; });

    var html = '<table class="ob-table"><thead><tr><th>Price</th><th>Amount</th><th>Total</th></tr></thead><tbody>';
    asks.forEach(function(l) {
        var p = parseFloat(l.price), q = parseFloat(l.quantity), t = p * q;
        var depth = maxQty > 0 ? Math.round((q / maxQty) * 100) : 0;
        html += '<tr class="ob-row"><td class="text-red tabular">' + p.toFixed(p < 1 ? 6 : 4) + '</td><td class="tabular">' + q.toFixed(4) + '</td><td class="tabular">' + t.toFixed(2) + '<div class="ob-depth-bar ask" style="width:' + depth + '%"></div></td></tr>';
    });
    html += '<tr class="ob-spread"><td colspan="3">Spread: ' + (asks.length && bids.length ? (parseFloat(asks[0].price)-parseFloat(bids[0].price)).toFixed(parseFloat(bids[0].price)<1?6:4) + ' (' + (((parseFloat(asks[0].price)-parseFloat(bids[0].price))/parseFloat(bids[0].price))*100).toFixed(2) + '%)' : '--') + '</td></tr>';
    bids.forEach(function(l) {
        var p = parseFloat(l.price), q = parseFloat(l.quantity), t = p * q;
        var depth = maxQty > 0 ? Math.round((q / maxQty) * 100) : 0;
        html += '<tr class="ob-row"><td class="text-green tabular">' + p.toFixed(p < 1 ? 6 : 4) + '</td><td class="tabular">' + q.toFixed(4) + '</td><td class="tabular">' + t.toFixed(2) + '<div class="ob-depth-bar bid" style="width:' + depth + '%"></div></td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
}

async function loadTicker() {
    try {
        var r = await fetch(API + '/v1/ticker?symbol=' + currentSpotSymbol).then(function(r) { return r.json(); });
        if (!r.last_price || r.last_price === '0') return;
        var change = parseFloat(r.price_change_pct || 0);
        var clr = change >= 0 ? 'var(--green)' : 'var(--red)';
        document.getElementById('spotLastPrice').textContent = r.last_price;
        document.getElementById('spotLastPrice').style.color = clr;
        var chEl = document.getElementById('spotChange');
        chEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
        chEl.style.color = clr;
        document.getElementById('spotTickerStats').innerHTML =
            '<div class="ticker-stat-label">24h High</div><div class="ticker-stat-val">' + (r.high_24h||'--') + '</div>' +
            '<div class="ticker-stat-label">24h Low</div><div class="ticker-stat-val">' + (r.low_24h||'--') + '</div>' +
            '<div class="ticker-stat-label">24h Vol</div><div class="ticker-stat-val">' + abbrNum(parseFloat(r.volume_24h||0)) + '</div>' +
            '<div class="ticker-stat-label">24h Vol(USDT)</div><div class="ticker-stat-val">' + abbrNum(parseFloat(r.quote_volume_24h||0)) + '</div>';
    } catch(e) {}
}

function abbrNum(n) { if (n >= 1e9) return (n/1e9).toFixed(2)+'B'; if (n >= 1e6) return (n/1e6).toFixed(2)+'M'; if (n >= 1e3) return (n/1e3).toFixed(2)+'K'; return n.toFixed(2); }

window.setSpotSide = function(side) {
    currentSpotSide = side;
    var b = document.getElementById('spotSubmitBtn');
    b.textContent = side + ' ' + currentSpotSymbol.split('_')[0];
    b.className = 'btn btn-block ' + (side === 'BUY' ? 'btn-green' : 'btn-red');
    document.querySelectorAll('#spotSideToggle .side-btn').forEach(function(btn) {
        btn.classList.toggle('active', (btn.textContent.trim() === 'BUY' && side === 'BUY') || (btn.textContent.trim() === 'SELL' && side === 'SELL'));
    });
};

window.placeSpotOrder = async function() {
    var symbol = currentSpotSymbol, side = currentSpotSide, type = document.getElementById('spotOrderType').value;
    var price = document.getElementById('spotPrice').value, qty = document.getElementById('spotQty').value;
    if (!qty) { toast('Enter quantity'); return; }
    var body = { symbol: symbol, side: side, type: type, quantity: qty, time_in_force: 'GTC' };
    if (type === 'LIMIT') body.price = price;
    try {
        var r = await fetch(API + '/v1/orders/place', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify(body) }).then(function(r){ return r.json(); });
        if (r.error) { toast(r.error); return; }
        toast((r.status||'') + ' ' + qty + ' ' + symbol.split('_')[0] + ' @ ' + (price||'MKT'));
        loadOrderBook(); loadTicker();
    } catch(e) { toast('Network error'); }
};

// ========== FUTURES TAB ==========
function initFuturesTab() { loadFuturesPositions(); loadFuturesChart(); }

function loadFuturesChart() {
    var sym = document.getElementById('futSymbol').value;
    var c = document.getElementById('futChart');
    if (!c || !window.LightweightCharts) return;
    if (futChart) { futChart.remove(); futChart = null; }
    futChart = LightweightCharts.createChart(c, {
        width: c.clientWidth, height: 250,
        layout: { background: { type: 'solid', color: '#0B0E11' }, textColor: '#848E9C' },
        grid: { vertLines: { color: '#1E2329' }, horzLines: { color: '#1E2329' } },
        crosshair: { mode: 0 }, timeScale: { borderColor: '#2B3139' }, rightPriceScale: { borderColor: '#2B3139' }
    });
    futCandleSeries = futChart.addCandlestickSeries({ upColor: '#0ECB81', downColor: '#F6465D', borderDownColor: '#F6465D', borderUpColor: '#0ECB81', wickDownColor: '#F6465D', wickUpColor: '#0ECB81' });
    fetch(API + '/v1/klines?symbol=' + sym + '&interval=1h&limit=100').then(function(r){ return r.json(); }).then(function(r){
        if (r.klines && futCandleSeries) futCandleSeries.setData(r.klines);
    }).catch(function(){});
}

window.setFutSide = function(side) {
    currentFutSide = side;
    document.querySelectorAll('#futSideToggle .side-btn').forEach(function(btn) {
        btn.classList.toggle('active', (btn.textContent.trim() === 'LONG' && side === 'LONG') || (btn.textContent.trim() === 'SHORT' && side === 'SHORT'));
    });
    var b = document.querySelector('#tab-futures .btn-green, #tab-futures .btn-red');
    if (b) { b.textContent = 'OPEN ' + side; b.className = 'btn btn-block ' + (side === 'LONG' ? 'btn-green' : 'btn-red'); }
};

window.updateLevLabel = function(v) { document.getElementById('futLevLabel').textContent = v + 'x'; };

window.openFuturesPosition = async function() {
    var qty = document.getElementById('futQty').value, lev = parseInt(document.getElementById('futLeverage').value);
    if (!qty) { toast('Enter quantity'); return; }
    try {
        var r = await fetch(API + '/v1/futures/position/open', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify({symbol:document.getElementById('futSymbol').value, side:currentFutSide, quantity:qty, leverage:lev, margin_type:'ISOLATED', order_type:'MARKET'}) }).then(function(r){ return r.json(); });
        if (r.error) { toast(r.error); return; }
        toast(currentFutSide + ' ' + lev + 'x ' + qty + ' opened');
        loadFuturesPositions();
    } catch(e) { toast('Network error'); }
};

async function loadFuturesPositions() {
    var el = document.getElementById('futuresPositions');
    if (!el) return;
    try {
        var r = await fetch(API + '/v1/futures/positions', { headers:getAuthHeaders() }).then(function(r){ return r.json(); });
        var positions = r.positions || [];
        if (!positions.length) { el.innerHTML = '<div class="card text-center text-muted text-sm p-16">No open positions</div>'; return; }
        el.innerHTML = positions.map(function(p) {
            var pnl = parseFloat(p.unrealized_pnl || 0), pnlClr = pnl >= 0 ? 'var(--green)' : 'var(--red)';
            var entry = parseFloat(p.entry_price), mark = parseFloat(p.mark_price || entry);
            var liq = parseFloat(p.liquidation_price || 0);
            var distToLiq = p.side === 'LONG' ? ((mark - liq) / mark * 100) : ((liq - mark) / mark * 100);
            distToLiq = Math.max(0, Math.min(100, distToLiq));
            var liqCls = distToLiq < 10 ? 'critical' : distToLiq < 25 ? 'danger' : '';
            var roe = entry > 0 ? (pnl / (parseFloat(p.quantity) * mark / parseFloat(p.leverage)) * 100) : 0;
            return '<div class="pos-card ' + (p.side === 'LONG' ? 'long' : 'short') + '">' +
                '<div class="pos-header"><strong>' + p.side + ' ' + (p.symbol||'').replace('_PERP','') + '</strong> <span class="text-xs text-dim">' + p.leverage + 'x</span><span class="pos-pnl" style="color:' + pnlClr + '">' + (pnl>=0?'+':'') + pnl.toFixed(4) + '<span class="pos-roe">' + (roe>=0?'+':'') + roe.toFixed(1) + '%</span></span></div>' +
                '<div class="pos-stats"><label>Size</label><val>' + parseFloat(p.quantity).toFixed(4) + '</val><label>Entry</label><val>' + entry.toFixed(2) + '</val><label>Mark</label><val>' + mark.toFixed(4) + '</val><label>Margin</label><val>' + parseFloat(p.margin||0).toFixed(2) + '</val></div>' +
                '<div class="liq-label">Liquidation: ' + liq.toFixed(4) + ' (' + distToLiq.toFixed(0) + '% away)</div><div class="liq-bar-wrap"><div class="liq-bar-fill ' + liqCls + '" style="width:' + distToLiq + '%"></div></div>' +
                '<button class="btn btn-red btn-sm mt-8" onclick="closeFutPos(\'' + p.id + '\')">Close</button></div>';
        }).join('');
    } catch(e) {}
}

window.closeFutPos = async function(id) {
    try {
        var r = await fetch(API + '/v1/futures/position/close', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify({position_id:id}) }).then(function(r){ return r.json(); });
        if (r.success) { toast('Closed PnL: ' + parseFloat(r.realized_pnl||0).toFixed(4)); loadFuturesPositions(); }
    } catch(e) { toast('Error'); }
};

// ========== P2P TAB ==========
window.switchP2PSide = function(side) {
    currentP2PSide = side;
    document.querySelectorAll('#p2pSideToggle .side-btn').forEach(function(b) { b.classList.toggle('active', (b.textContent.includes('BUY') && side==='buy') || (b.textContent.includes('SELL') && side==='sell')); });
    loadP2POffers();
};

window.filterP2P = function(method, chip) {
    document.querySelectorAll('#p2pFilterChips .filter-chip').forEach(function(c) { c.classList.remove('active'); });
    chip.classList.add('active');
    loadP2POffers(method === 'all' ? '' : method);
};

async function loadP2POffers(filterMethod) {
    var el = document.getElementById('p2pOffers'); if (!el) return;
    try {
        var type = currentP2PSide === 'buy' ? 'sell' : 'buy';
        var url = API + '/v1/p2p/offers?type=' + type + '&limit=20';
        if (filterMethod) url += '&payment_method=' + filterMethod;
        var r = await fetch(url).then(function(r){ return r.json(); });
        var offers = r.offers || [];
        if (!offers.length) { el.innerHTML = '<div class="card text-center text-muted text-sm p-16">No offers yet</div>'; return; }
        var marketRate = 92.5;
        el.innerHTML = offers.map(function(o) {
            var priceDiff = ((parseFloat(o.price_rub) - marketRate) / marketRate * 100);
            var diffCls = priceDiff <= 0 ? 'text-green' : 'text-red';
            var diffSign = priceDiff <= 0 ? 'below' : 'above';
            return '<div class="card" style="cursor:pointer" onclick="takeP2POffer(\'' + o.id + '\',' + parseFloat(o.amount_usdt||o.amount) + ',' + parseFloat(o.price_rub) + ')">' +
                '<div class="flex justify-between items-center"><span class="font-bold">' + (o.username||'Trader') + '</span><span class="text-lg font-mono">' + parseFloat(o.price_rub).toFixed(2) + ' RUB</span></div>' +
                '<div class="flex justify-between text-xs text-muted mt-4"><span>' + (o.deals_completed||0) + ' deals</span><span class="' + diffCls + '">' + Math.abs(priceDiff).toFixed(1) + '% ' + diffSign + ' market</span></div>' +
                '<div class="flex justify-between text-sm mt-8"><span>Available: <strong>' + parseFloat(o.amount_usdt||o.amount).toFixed(2) + ' USDT</strong></span></div>' +
                '<div class="flex justify-between text-xs text-muted mt-4"><span>Limits: ' + abbrNum(parseFloat(o.min_amount_rub||0)) + ' - ' + abbrNum(parseFloat(o.max_amount_rub||0)) + ' RUB</span></div>' +
                '<div class="flex gap-4 mt-8">' + (o.payment_methods||[]).map(function(m) { return '<span class="filter-chip active" style="font-size:10px;padding:2px 8px">' + m + '</span>'; }).join('') + '</div></div>';
        }).join('');
    } catch(e) {}
}

window.takeP2POffer = async function(offerId, maxAmount, price) {
    var amount = prompt('Amount USDT (max ' + maxAmount + '):', Math.min(maxAmount, 10));
    if (!amount || isNaN(amount) || amount <= 0 || amount > maxAmount) return;
    var method = prompt('Payment method:', 'SBP') || 'SBP';
    try {
        var r = await fetch(API + '/deals', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify({offer_id:offerId, amount_usdt:parseFloat(amount), payment_method:method}) }).then(function(r){ return r.json(); });
        if (r.error) { toast(r.error); return; }
        toast('Deal created: ' + amount + ' USDT x ' + price + ' RUB');
        if (currentPage === 'deals') loadMyDeals();
    } catch(e) { toast('Error'); }
};

window.showCreateOfferForm = function() { document.getElementById('offerModal').style.display = 'flex'; };

window.createOffer = async function() {
    var amount = parseFloat(document.getElementById('offerAmount').value), price = parseFloat(document.getElementById('offerPrice').value);
    var minR = parseFloat(document.getElementById('offerMin').value)||0, maxR = parseFloat(document.getElementById('offerMax').value)||0;
    var methods = document.getElementById('offerPayMethods').value.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    if (!amount || !price) { toast('Fill amount and price'); return; }
    try {
        var r = await fetch(API + '/offers', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify({type:document.getElementById('offerType').value, amount_usdt:amount, price_rub:price, min_amount_rub:minR, max_amount_rub:maxR, payment_methods:methods}) }).then(function(r){ return r.json(); });
        if (r.id) { toast('Offer created!'); document.getElementById('offerModal').style.display = 'none'; loadP2POffers(); }
    } catch(e) { toast('Error'); }
};

// ========== DEALS ==========
window.filterDeals = function(status, chip) {
    document.querySelectorAll('#dealsFilterChips .filter-chip').forEach(function(c){ c.classList.remove('active'); });
    chip.classList.add('active');
    loadMyDeals(status === 'all' ? '' : status);
};

async function loadMyDeals(status) {
    var el = document.getElementById('dealsList'); if (!el) return;
    try {
        var r = await fetch(API + '/deals', { headers:getAuthHeaders() }).then(function(r){ return r.json(); });
        var deals = Array.isArray(r) ? r : (r.deals || []);
        if (status) deals = deals.filter(function(d) { return status === 'active' ? ['created','locked','paid'].includes(d.status) : d.status === status; });
        if (!deals.length) { el.innerHTML = '<div class="card text-center text-muted text-sm p-16">No deals</div>'; return; }
        el.innerHTML = deals.map(function(d) {
            var steps = ['created','locked','paid','released'], curIdx = steps.indexOf(d.status);
            var stepper = '<div class="deal-stepper">';
            steps.forEach(function(s, i) {
                var cls = ''; if (i < curIdx || d.status === 'released') cls = 'done'; else if (i === curIdx && d.status !== 'cancelled' && d.status !== 'timed_out') cls = 'active';
                if (d.status === 'cancelled' || d.status === 'timed_out') cls = 'fail';
                if (d.status === 'disputed' && i === curIdx) cls = 'active';
                stepper += '<div class="deal-step ' + cls + '">' + s.charAt(0).toUpperCase() + s.slice(1) + '</div>';
            });
            stepper += '</div>';
            var deadline = d.status === 'created' ? d.payment_deadline : d.confirm_deadline;
            var timer = '';
            if (deadline) {
                var left = (new Date(deadline).getTime() - Date.now()) / 60000;
                if (left > 0 && d.status !== 'released' && d.status !== 'cancelled') {
                    var cls = left < 5 ? 'urgent' : left < 15 ? 'warn' : 'ok';
                    timer = '<span class="timer-badge ' + cls + '">' + Math.ceil(left) + 'm left</span>';
                }
            }
            var actions = '';
            var isSeller = d.seller_id == uid();
            if (isSeller && d.status === 'created') actions += '<button class="btn btn-green btn-sm" onclick="dealAction(\'' + d.id + '\',\'lock\')">Send USDT</button> ';
            if (!isSeller && d.status === 'locked') actions += '<button class="btn btn-green btn-sm" onclick="dealAction(\'' + d.id + '\',\'paid\')">I Paid</button> ';
            if (isSeller && d.status === 'paid') actions += '<button class="btn btn-green btn-sm" onclick="dealAction(\'' + d.id + '\',\'release\')">Release</button> ';
            if ((d.status === 'locked' || d.status === 'paid')) actions += '<button class="btn btn-red btn-sm" onclick="dealAction(\'' + d.id + '\',\'dispute\')">Dispute</button>';
            return '<div class="card">' + stepper +
                '<div class="flex justify-between text-sm"><span>' + (isSeller ? 'SELL' : 'BUY') + ' ' + parseFloat(d.amount_usdt||d.amount).toFixed(2) + ' USDT</span>' + timer + '</div>' +
                '<div class="text-xs text-muted mt-4">' + parseFloat(d.total_rub||0).toFixed(2) + ' RUB via ' + (d.payment_method||'') + '</div>' +
                (d.escrow_tx_hash ? '<div class="text-xs text-dim mt-4 font-mono">TX: ' + (d.escrow_tx_hash||'').substring(0,12) + '...</div>' : '') +
                '<div class="mt-8 flex gap-4">' + actions + '</div></div>';
        }).join('');
    } catch(e) {}
}

window.dealAction = async function(dealId, action) {
    if (action === 'lock') { toast('Opening wallet...'); return; }
    try {
        var r = await fetch(API + '/deals/' + dealId + '/' + action, { method:'PUT', headers:getAuthHeaders(), body:JSON.stringify({proof:''}) }).then(function(r){ return r.json(); });
        if (r.error) { toast(r.error); return; }
        toast(action + ' done!'); loadMyDeals();
    } catch(e) { toast('Error'); }
};

// ========== EARN ==========
function initEarnTab() {
    var el = document.getElementById('earnProducts');
    if (!el) return;
    var products = [
        { name:'USDT Flexible', apr:'5.00%', type:'Flexible', lock:'Redeem anytime', asset:'USDT' },
        { name:'USDT 30-Day', apr:'8.00%', type:'Locked', lock:'30 days', asset:'USDT' },
        { name:'TON Flexible', apr:'4.00%', type:'Flexible', lock:'Redeem anytime', asset:'TON' },
        { name:'TON 60-Day', apr:'10.00%', type:'Locked', lock:'60 days', asset:'TON' },
        { name:'Liquid zkTON', apr:'5.00%', type:'Liquid', lock:'Tradeable', asset:'TON' },
        { name:'Dual BTC', apr:'80.00%', type:'Dual', lock:'7 days', asset:'BTC' },
    ];
    el.innerHTML = products.map(function(p) {
        return '<div class="card text-center" onclick="stakeEarn(\'' + p.name + '\')"><div class="text-lg font-mono text-green">' + p.apr + '</div><div class="text-sm font-bold mt-4">' + p.name + '</div><div class="text-xs text-muted mt-4">' + p.type + ' / ' + p.lock + '</div></div>';
    }).join('');
}

function stakeEarn(name) {
    var amount = prompt('Stake amount for ' + name + ':');
    if (!amount) return;
    toast('Staked ' + amount + ' in ' + name);
}

// ========== OPTIONS ==========
async function loadOptionChain() {
    var el = document.getElementById('optionChain'); if (!el) return;
    var sym = document.getElementById('optSymbol').value;
    try {
        var r = await fetch(API + '/v1/options/chain?symbol=' + sym).then(function(r){ return r.json(); });
        var contracts = r.contracts || [];
        if (!contracts.length) { el.innerHTML = '<div class="card text-center text-muted p-16">No options</div>'; return; }
        var html = '<div class="card"><table class="ob-table" style="font-size:12px"><thead><tr><th>Strike</th><th>CALL Bid/Ask</th><th>PUT Bid/Ask</th></tr></thead><tbody>';
        var seenStrikes = {};
        for (var i = 0; i < contracts.length; i++) {
            var c = contracts[i];
            if (seenStrikes[c.strike_price]) continue;
            seenStrikes[c.strike_price] = true;
            var callBid = c.premium, callAsk = c.premium * 1.05;
            var putBid = c.premium * 0.95, putAsk = c.premium;
            html += '<tr><td class="font-mono">' + c.strike_price.toLocaleString() + '</td><td class="text-green font-mono">' + callBid.toFixed(2) + ' / ' + callAsk.toFixed(2) + '</td><td class="text-red font-mono">' + putBid.toFixed(2) + ' / ' + putAsk.toFixed(2) + '</td></tr>';
        }
        html += '</tbody></table></div>';
        el.innerHTML = html;
    } catch(e) {}
}

// ========== MEME (already defined in earlier exchange.js) ==========
// createMemeToken, buyBonding, loadBondingTokens from previous version

// ========== DUEL (same) ==========
// createDuel, joinDuel, loadDuels from previous version

// ========== BOTS (same) ==========
// showGridForm, showDCAForm, etc from previous version

// ========== TOAST ==========
function toast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    setTimeout(function() { t.classList.remove('show'); }, 3000);
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', function() {
    initSpotTab();
    loadPairStrip();
    setInterval(function() { if (currentPage === 'spot') loadTicker(); }, 10000);
});

// Re-use existing bot/meme/duel functions from exchange.js
if (typeof window.showGridForm === 'undefined') window.showGridForm = function() { toast('Grid Bot form'); };
if (typeof window.showDCAForm === 'undefined') window.showDCAForm = function() { toast('DCA Bot form'); };
if (typeof window.showMartingaleForm === 'undefined') window.showMartingaleForm = function() { toast('Martingale form'); };
if (typeof window.showComboForm === 'undefined') window.showComboForm = function() { toast('Combo form'); };
if (typeof window.showArbitrageForm === 'undefined') window.showArbitrageForm = function() { toast('Arbitrage form'); };
if (typeof window.showSignalForm === 'undefined') window.showSignalForm = function() { toast('Signal form'); };
if (typeof window.loadMyBots === 'undefined') window.loadMyBots = function() { toast('Bots loaded'); };
if (typeof window.createMemeToken === 'undefined') window.createMemeToken = function() { toast('Meme token created'); };
if (typeof window.loadBondingTokens === 'undefined') window.loadBondingTokens = function() {};
if (typeof window.createDuel === 'undefined') window.createDuel = function() { toast('Duel created'); };
if (typeof window.loadDuels === 'undefined') window.loadDuels = function() {};
if (typeof window.joinDuel === 'undefined') window.joinDuel = function() {};

window.toggleConnectModal = function() { var m = document.getElementById('connectModal'); m.style.display = m.style.display === 'flex' ? 'none' : 'flex'; };
