// P2P Exchange Mini App
// ============================================

const API = 'https://p2p-exchange-api.vercel.app/api';
const tg = window.Telegram?.WebApp;

let currentUser = null;
let offersBuy = [];
let offersSell = [];
let myDeals = [];

// ========== TON CONNECT ==========
let tonConnect = null;
let connectedWallet = null;

function initTonConnect() {
    if (typeof window.TonConnectUI === 'undefined') return;
    tonConnect = new window.TonConnectUI({
        manifestUrl: 'https://p2p-exchange-sigma.vercel.app/tonconnect-manifest.json',
        buttonRootId: 'btnConnectWallet',
    });
    tonConnect.onStatusChange((wallet) => {
        if (wallet) {
            connectedWallet = wallet.account.address;
            document.getElementById('btnConnectWallet').textContent =
                connectedWallet.slice(0, 6) + '...' + connectedWallet.slice(-4);
            document.getElementById('btnConnectWallet').classList.add('connected');
        } else {
            connectedWallet = null;
            document.getElementById('btnConnectWallet').textContent = 'Connect TON';
            document.getElementById('btnConnectWallet').classList.remove('connected');
        }
    });
}

// ========== TELEGRAM STARS ==========
async function payWithStars(amount, description) {
    if (!tg || !tg.isVersionAtLeast('6.1')) {
        toast('Telegram Stars require Telegram 6.1+');
        return false;
    }
    try {
        const result = await tg.showPopup({
            title: 'Pay with Stars',
            message: `${amount} Stars — ${description}`,
            buttons: [
                { type: 'ok', text: 'Pay' },
                { type: 'cancel', text: 'Cancel' },
            ],
        });
        if (result === 'ok') {
            await api('/stars/pay', 'POST', { amount, description });
            return true;
        }
    } catch (e) {
        console.error('Stars payment error:', e);
    }
    return false;
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
    if (tg) { tg.ready(); tg.expand(); }
    initTonConnect();
    initAuth();
    initTabs();
    initButtons();
    loadStats();
    loadBuyOffers();
    setInterval(loadStats, 30000);
});

async function api(path, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (currentUser) headers['X-Telegram-User-ID'] = currentUser.id;
    if (tg && tg.initData) headers['X-Telegram-InitData'] = tg.initData;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    try {
        const res = await fetch(API + path, opts);
        return await res.json();
    } catch (e) {
        console.error('API error:', e);
        return null;
    }
}

function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

function formatRub(n) { return Number(n).toLocaleString('ru-RU') + ' RUB'; }
function formatUsdt(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' USDT'; }

// ========== AUTH ==========
async function initAuth() {
    if (tg?.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        currentUser = { id: u.id, username: u.username || '', first_name: u.first_name };
        await api('/auth', 'POST', u);
    } else {
        currentUser = { id: 111, username: 'demo', first_name: 'Demo' };
    }
}

// ========== TABS ==========
function initTabs() {
    document.querySelectorAll('.tab').forEach(t => {
        t.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            document.getElementById('tab-' + t.dataset.tab).classList.add('active');
            if (t.dataset.tab === 'buy') loadBuyOffers();
            if (t.dataset.tab === 'sell') loadSellOffers();
            if (t.dataset.tab === 'deals') loadMyDeals();
            if (t.dataset.tab === 'profile') loadProfile();
        });
    });
}

// ========== STATS ==========
async function loadStats() {
    const data = await api('/stats');
    if (!data) return;
    document.getElementById('statsBar').innerHTML =
        `24h Volume: ${formatRub(data.volume24h)} | Deals: ${data.deals24h} | Active: ${data.activeUsers}`;
}

// ========== BUY OFFERS ==========
async function loadBuyOffers() {
    const type = 'sell';
    const data = await api('/offers?type=' + type);
    if (!data || !Array.isArray(data)) {
        document.getElementById('offersBuy').innerHTML = '<p style="text-align:center;color:#8b949e;padding:40px">No offers yet</p>';
        return;
    }
    offersBuy = data;
    renderOffers('offersBuy', offersBuy, 'buy');
}

async function loadSellOffers() {
    const type = 'buy';
    const data = await api('/offers?type=' + type);
    if (!data || !Array.isArray(data)) {
        document.getElementById('offersSell').innerHTML = '<p style="text-align:center;color:#8b949e;padding:40px">No offers yet</p>';
        return;
    }
    offersSell = data;
    renderOffers('offersSell', offersSell, 'sell');
}

function renderOffers(containerId, offers, actionType) {
    const container = document.getElementById(containerId);
    if (!offers.length) {
        container.innerHTML = '<p style="text-align:center;color:#8b949e;padding:40px">No offers available</p>';
        return;
    }
    container.innerHTML = offers.map(o => {
        const stars = '★'.repeat(Math.round(o.rating || 0)) + '☆'.repeat(5 - Math.round(o.rating || 0));
        return `
            <div class="offer-card">
                <div class="row">
                    <span class="trader">${o.username || 'User'} <span class="rating">${stars} (${o.deals_completed || 0})</span></span>
                </div>
                <div class="row">
                    <span class="amount">${formatUsdt(o.amount_usdt)}</span>
                    <span class="price">${o.price_rub} RUB</span>
                </div>
                <div class="limits">Min: ${formatRub(o.min_amount_rub)} - Max: ${formatRub(o.max_amount_rub)}</div>
                <div class="payments">${(o.payment_methods || []).map(p => `<span class="payment-tag">${p}</span>`).join('')}</div>
                <button class="btn-trade ${actionType === 'sell' ? 'btn-sell' : ''}" onclick="openDealForm('${o.id}',${o.amount_usdt},${o.price_rub},'${actionType}')">
                    ${actionType === 'buy' ? 'BUY USDT' : 'SELL USDT'}
                </button>
            </div>
        `;
    }).join('');
}

// ========== CREATE DEAL ==========
async function openDealForm(offerId, maxAmount, price, type) {
    const amount = prompt('Enter amount (USDT):', String(maxAmount));
    if (!amount || isNaN(amount) || amount <= 0 || amount > maxAmount) {
        if (amount) toast('Invalid amount');
        return;
    }
    const method = prompt('Payment method (SBP, T-Bank, Sberbank):', 'SBP') || 'SBP';
    const data = await api('/deals', 'POST', {
        offer_id: offerId,
        amount_usdt: parseFloat(amount),
        payment_method: method,
    });
    if (data?.error) { toast(data.error); return; }
    toast('Deal created! Total: ' + formatRub(data.total_rub));
    loadBuyOffers();
    loadSellOffers();
}

// ========== MY DEALS ==========
async function loadMyDeals() {
    const data = await api('/deals');
    myDeals = data || [];
    renderDeals();
}

function renderDeals() {
    const container = document.getElementById('dealsList');
    if (!myDeals.length) {
        container.innerHTML = '<p style="text-align:center;color:#8b949e;padding:40px">No deals yet</p>';
        return;
    }
    container.innerHTML = myDeals.map(d => {
        const statusClass = 'status-' + d.status;
        const statusText = {
            pending: 'PENDING', locked: 'USDT LOCKED', paid: 'RUB PAID',
            completed: 'COMPLETED', cancelled: 'CANCELLED', disputed: 'DISPUTED'
        }[d.status];
        const isBuyer = d.buyer_id === currentUser?.id;
        const isSeller = d.seller_id === currentUser?.id;
        let actions = '';
        if (isSeller && d.status === 'pending') {
            actions += `<button class="btn-action btn-action-lock" onclick="lockDeal('${d.id}')">Lock USDT</button>`;
        }
        if (isBuyer && d.status === 'locked') {
            actions += `<button class="btn-action btn-action-paid" onclick="markPaid('${d.id}')">I Paid RUB</button>`;
        }
        if (isSeller && d.status === 'paid') {
            actions += `<button class="btn-action btn-action-confirm" onclick="confirmDeal('${d.id}')">Confirm RUB Received</button>`;
        }
        if ((isBuyer || isSeller) && (d.status === 'locked' || d.status === 'paid')) {
            actions += `<button class="btn-action btn-action-dispute" onclick="disputeDeal('${d.id}')">Dispute</button>`;
        }
        return `
            <div class="deal-card">
                <div class="deal-header">
                    <span>${isBuyer ? 'Buy from' : 'Sell to'} ${isBuyer ? d.seller_name : d.buyer_name}</span>
                    <span class="status ${statusClass}">${statusText}</span>
                </div>
                <div class="deal-info">${formatUsdt(d.amount_usdt)} x ${(d.total_rub / d.amount_usdt).toFixed(2)} RUB</div>
                <div class="deal-amount">${formatRub(d.total_rub)}</div>
                ${d.payment_method ? `<div class="deal-info" style="margin-top:4px">Payment: ${d.payment_method}</div>` : ''}
                <div style="margin-top:6px">${actions}</div>
            </div>
        `;
    }).join('');
}

async function lockDeal(dealId) {
    const txHash = prompt('Enter TON transaction hash (or leave empty for manual):');
    const data = await api('/deals/' + dealId + '/lock', 'PUT', { tx_hash: txHash || '' });
    if (data?.error) { toast(data.error); return; }
    toast('USDT locked. Waiting for buyer payment.');
    loadMyDeals();
}

async function markPaid(dealId) {
    if (!confirm('Confirm you have sent RUB to the seller?')) return;
    const data = await api('/deals/' + dealId + '/paid', 'PUT', { proof: '' });
    if (data?.error) { toast(data.error); return; }
    toast('Payment marked. Waiting for seller confirmation.');
    loadMyDeals();
}

async function confirmDeal(dealId) {
    if (!confirm('Confirm you have received RUB on your account?')) return;
    const data = await api('/deals/' + dealId + '/confirm', 'PUT');
    if (data?.error) { toast(data.error); return; }
    toast('Deal completed! USDT will be released.');
    loadMyDeals();
}

async function disputeDeal(dealId) {
    const reason = prompt('Reason for dispute:');
    if (!reason) return;
    const data = await api('/deals/' + dealId + '/dispute', 'PUT', { reason });
    if (data?.error) { toast(data.error); return; }
    toast('Dispute opened. Admin will review.');
    loadMyDeals();
}

// ========== PROFILE ==========
async function loadProfile() {
    const data = await api('/profile');
    if (!data) return;

    const scoring = await api('/scoring');
    const bonds = await api('/bonds/status');
    const cards = await api('/cards');

    const limitsHtml = scoring?.limits?.quarantine
        ? '<div class="warning-badge">QUARANTINE: max ' + scoring.limits.maxDealUsdt + ' USDT/deal</div>'
        : '<div class="ok-badge">Level: ' + (scoring?.limits?.level || 'Standard') + '</div>';

    const bondHtml = bonds?.isMaker
        ? '<div class="ok-badge">Maker: ' + bonds.bondAmount + ' USDT bonded</div>'
        : '<div class="info-badge">Not a maker. Bond: ' + (bonds?.requiredBond || 500) + ' USDT required</div>';

    const cardsHtml = cards && cards.length > 0
        ? '<div class="ok-badge">' + cards.length + ' card(s) bound</div>'
        : '<div class="info-badge">No cards bound</div>';

    document.getElementById('profileSection').innerHTML = `
        <div class="profile-section">
            <h3 style="margin-bottom:12px">${data.username || 'User #' + data.id}</h3>
            <div class="stats-row">
                <div class="profile-stat"><div class="value">${data.deals_completed || 0}</div><div class="label">Deals</div></div>
                <div class="profile-stat"><div class="value">${data.trust_score || 0}</div><div class="label">Trust</div></div>
                <div class="profile-stat"><div class="value">${data.rating || 0}</div><div class="label">Rating</div></div>
            </div>
            <div style="margin-top:12px;font-size:11px;text-align:left;padding:0 8px">
                ${limitsHtml}
                ${bondHtml}
                ${cardsHtml}
            </div>
            <div class="wallet-label" style="margin-top:12px">Your TON Wallet</div>
            <input class="wallet-input" id="walletInput" value="${data.ton_wallet || ''}" placeholder="Enter your TON wallet address...">
            <button class="btn-primary" onclick="saveWallet()" style="width:100%">Save Wallet</button>
            <button class="btn-primary" onclick="document.getElementById('createOfferModal').classList.add('active')" style="width:100%;margin-top:8px;background:#1f6feb">Create Offer</button>
        </div>
    `;
}

async function saveWallet() {
    const wallet = document.getElementById('walletInput').value.trim();
    if (!wallet) { toast('Enter wallet address'); return; }
    await api('/profile', 'PUT', { ton_wallet: wallet });
    toast('Wallet saved');
}

// ========== CREATE OFFER ==========
async function createOffer() {
    const o = {
        type: document.getElementById('offerType').value,
        amount_usdt: parseFloat(document.getElementById('offerAmount').value),
        price_rub: parseFloat(document.getElementById('offerPrice').value),
        min_amount_rub: parseFloat(document.getElementById('offerMin').value) || 0,
        max_amount_rub: parseFloat(document.getElementById('offerMax').value) || 0,
        payment_methods: document.getElementById('offerPayMethods').value.split(',').map(s => s.trim()).filter(Boolean),
    };
    if (!o.amount_usdt || !o.price_rub) { toast('Fill amount and price'); return; }
    const data = await api('/offers', 'POST', o);
    if (data?.error) { toast(data.error); return; }
    document.getElementById('createOfferModal').classList.remove('active');
    toast('Offer created');
    loadBuyOffers();
    loadSellOffers();
}

// ========== BUTTONS ==========
function initButtons() {
    document.getElementById('btnCreateOffer').addEventListener('click', createOffer);
    document.getElementById('btnCancelOffer').addEventListener('click', () => document.getElementById('createOfferModal').classList.remove('active'));
    document.getElementById('paymentFilter').addEventListener('change', loadBuyOffers);
    document.getElementById('sortFilter').addEventListener('change', loadBuyOffers);

    // Float button
    const fab = document.createElement('button');
    fab.className = 'btn-float';
    fab.textContent = '+';
    fab.onclick = () => document.getElementById('createOfferModal').classList.add('active');
    document.body.appendChild(fab);
}

// ========== CHARTS & TRADINGVIEW ==========
function initCharts() {
    if (typeof TradingView === 'undefined') {
        document.getElementById('tradingview-widget').innerHTML =
            '<div style="height:300px;display:flex;align-items:center;justify-content:center;color:#8b949e">Chart loading...</div>';
        return;
    }
    new TradingView.widget({
        container_id: "tradingview-widget",
        width: "100%",
        height: 300,
        symbol: "BINANCE:USDTUSDC",
        interval: "60",
        timezone: "Europe/Moscow",
        theme: "dark",
        style: "1",
        locale: "ru",
        toolbar_bg: "#161b22",
        enable_publishing: false,
        hide_side_toolbar: true,
        allow_symbol_change: false,
    });
}

// ========== LIVE RATES ==========
async function loadRates() {
    try {
        const data = await api('/rates');
        if (!data) return;
        document.getElementById('rateBinance').textContent =
            'Binance: ' + (data.sources?.find(s => s.exchange === 'Binance')?.rate || '--');
        document.getElementById('rateBybit').textContent =
            'Bybit: ' + (data.sources?.find(s => s.exchange === 'Bybit')?.rate || '--');
        document.getElementById('rateDisplay').textContent =
            '1 USDT = ' + (data.usdtRub || '92.50') + ' RUB';
    } catch {}
}

// ========== TON CONNECT TRANSFER ==========
async function sendTONviaTonkeeper(amount, dealId) {
    if (!connectedWallet) {
        toast('Connect TON wallet first');
        return null;
    }
    const transfer = await api('/ton/transfer', 'POST', {
        sender: connectedWallet,
        amount: parseFloat(amount),
        dealId: dealId,
    });
    if (!transfer) return null;

    if (tonConnect) {
        try {
            const tx = {
                validUntil: Math.floor(Date.now() / 1000) + 300,
                messages: [{
                    address: transfer.recipient,
                    amount: transfer.amount,
                    payload: transfer.payload?.forwardPayload || '',
                }],
            };
            const result = await tonConnect.sendTransaction(tx);
            return result;
        } catch (e) {
            console.error('TON tx error:', e);
        }
    }

    window.open(transfer.signedUrl, '_blank');
    return transfer;
}

// ========== COMMISSION INFO ==========
async function loadCommissionInfo() {
    const data = await api('/commission');
    if (!data) return;
    document.getElementById('commissionInfo').innerHTML =
        '<div style="padding:12px;background:#161b22;border:1px solid #21262d;border-radius:8px;margin-top:8px;font-size:12px;color:#8b949e">' +
        'Fee: ' + data.effectiveFee + '% | ' +
        'Volume 30d: ' + (data.totalVolume30d || 0).toFixed(2) + ' USDT | ' +
        'Platform: ' + (data.platformWallet || '').slice(0, 8) + '...' +
        '</div>';
}

// ========== WEBSOCKET ==========
let ws = null;
function connectWebSocket(uid) {
    try {
        ws = new WebSocket('wss://p2p-exchange-api.vercel.app/ws?user_id=' + (uid || 'anon'));
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.event === 'deal_update' || msg.event === 'new_offer') {
                loadMyDeals();
                loadBuyOffers();
                loadSellOffers();
            }
        };
        ws.onclose = () => setTimeout(() => connectWebSocket(uid), 5000);
    } catch {}
}

// Update init buttons to include charts
document.addEventListener('DOMContentLoaded', () => {
    const orig = initButtons;
    initButtons = function() {
        orig();
        initCharts();
        loadRates();
        loadCommissionInfo();
        setInterval(loadRates, 30000);
        if (currentUser) connectWebSocket(currentUser.id);
    };
});
