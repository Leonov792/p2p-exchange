// P2P Exchange — Working Frontend
// ============================================
const API = 'https://p2p-exchange-api.vercel.app/api';
const tg = window.Telegram?.WebApp;
let currentUser = null;
let currentTab = 'buy';

function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

async function api(path, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (currentUser) headers['X-Telegram-User-ID'] = String(currentUser.id);
    if (tg?.initData) headers['X-Telegram-InitData'] = tg.initData;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    try {
        const res = await fetch(API + path, opts);
        const data = await res.json();
        if (!res.ok) { toast(data.error || 'Error ' + res.status); return null; }
        return data;
    } catch (e) {
        console.error('API:', e.message);
        toast('Network error. Retrying...');
        return null;
    }
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
    if (tg) { tg.ready(); tg.expand(); }
    window._currentUser = currentUser;
    initTabs();
    initAuth();
    initOfferForm();
    loadBuyOffers();
    loadLiveRates();
    setInterval(refreshData, 15000);
    setInterval(loadLiveRates, 30000);
});

async function initAuth() {
    if (tg?.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        currentUser = { id: u.id, username: u.username, first_name: u.first_name };
        const data = await api('/auth', 'POST', { ...u, start_param: tg.initDataUnsafe?.start_param || '' });
        if (data) toast('Logged in as: ' + (u.first_name || u.username || u.id));
    } else {
        currentUser = { id: Math.floor(Math.random() * 900000) + 100000, username: 'web_user', first_name: 'Guest' };
        toast('Demo mode. Use Telegram for full access.');
    }
    loadProfile();
}

// ========== TABS ==========
function initTabs() {
    document.querySelectorAll('.tab').forEach(t => {
        t.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            currentTab = t.dataset.tab;
            document.getElementById('tab-' + currentTab).classList.add('active');
            refreshData();
        });
    });
}

async function refreshData() {
    if (currentTab === 'buy') await loadBuyOffers();
    if (currentTab === 'sell') await loadSellOffers();
    if (currentTab === 'deals') await loadMyDeals();
    if (currentTab === 'profile') await loadProfile();
}

// ========== OFFERS ==========
async function loadBuyOffers() {
    const data = await api('/offers?type=sell');
    renderOffers(data || [], 'offersBuy', 'BUY');
}

async function loadSellOffers() {
    const data = await api('/offers?type=buy');
    renderOffers(data || [], 'offersSell', 'SELL');
}

function renderOffers(offers, containerId, action) {
    const container = document.getElementById(containerId);
    if (!offers.length) {
        container.innerHTML = '<p style="text-align:center;color:#8b949e;padding:40px">No offers yet. Create one!</p>';
        return;
    }
    container.innerHTML = offers.map(o => `
        <div class="offer-card">
            <div class="row">
                <span class="trader">${o.username || 'User'} <span class="rating">(${o.deals_completed || 0} deals)</span></span>
                <span class="price">${o.price_rub} RUB/USDT</span>
            </div>
            <div class="row" style="margin-top:4px">
                <span class="amount">${Number(o.amount_usdt).toFixed(2)} USDT</span>
            </div>
            <div class="limits">Min: ${Number(o.min_amount_rub||0).toLocaleString('ru')} - Max: ${Number(o.max_amount_rub||0).toLocaleString('ru')} RUB</div>
            <div class="payments">${(o.payment_methods||[]).map(p => `<span class="payment-tag">${p}</span>`).join('')}</div>
            <button class="btn-trade" onclick="takeOffer('${o.id}',${o.amount_usdt},${o.price_rub},'${o.type}')">
                ${action} ${Number(o.amount_usdt).toFixed(2)} USDT
            </button>
        </div>
    `).join('');
}

// ========== TAKE OFFER ==========
async function takeOffer(offerId, maxAmount, price, type) {
    const amount = prompt('Enter amount (USDT):', String(Math.min(maxAmount, 10)));
    if (!amount || isNaN(amount) || amount <= 0 || amount > maxAmount) {
        if (amount) toast('Invalid amount. Max: ' + maxAmount);
        return;
    }
    const method = prompt('Payment method (SBP, T-Bank, Sberbank):', 'SBP') || 'SBP';

    toast('Creating deal...');
    const data = await api('/deals', 'POST', {
        offer_id: offerId,
        amount_usdt: parseFloat(amount),
        payment_method: method,
    });

    if (data) {
        toast('Deal created! ' + Number(data.amount_usdt).toFixed(2) + ' USDT x ' + price + ' RUB');
        loadMyDeals();
        loadBuyOffers();
    }
}

// ========== CREATE OFFER ==========
function initOfferForm() {
    document.getElementById('btnCreateOffer').onclick = async () => {
        const type = document.getElementById('offerType').value;
        const amount = parseFloat(document.getElementById('offerAmount').value);
        const price = parseFloat(document.getElementById('offerPrice').value);
        const minR = parseFloat(document.getElementById('offerMin').value) || 0;
        const maxR = parseFloat(document.getElementById('offerMax').value) || 0;
        const pay = document.getElementById('offerPayMethods').value.split(',').map(s => s.trim()).filter(Boolean);

        if (!amount || !price) { toast('Fill amount and price'); return; }

        toast('Creating offer...');
        const data = await api('/offers', 'POST', {
            type, amount_usdt: amount, price_rub: price,
            min_amount_rub: minR, max_amount_rub: maxR, payment_methods: pay,
        });

        if (data) {
            toast(type === 'sell' ? 'SELL offer created!' : 'BUY offer created!');
            document.getElementById('createOfferModal').classList.remove('active');
            loadBuyOffers(); loadSellOffers();
        }
    };
    document.getElementById('btnCancelOffer').onclick = () => document.getElementById('createOfferModal').classList.remove('active');
    document.getElementById('btnFloatCreate').onclick = () => document.getElementById('createOfferModal').classList.add('active');
}

// ========== DEALS ==========
async function loadMyDeals() {
    const data = await api('/deals');
    const container = document.getElementById('dealsList');
    if (!data?.length) {
        container.innerHTML = '<p style="text-align:center;color:#8b949e;padding:40px">No deals yet</p>';
        return;
    }
    container.innerHTML = data.map(d => {
        const isBuyer = d.buyer_id === currentUser?.id;
        const isSeller = d.seller_id === currentUser?.id;
        const statusColors = { created:'#d29922', locked:'#1f6feb', paid:'#58a6ff', released:'#238636', cancelled:'#30363d', disputed:'#da3633', timed_out:'#484f58' };
        let actions = '';
        if (isSeller && d.status === 'created') actions += `<button class="btn-action btn-action-lock" onclick="dealAction('${d.id}','lock')">Send USDT (TON)</button>`;
        if (isBuyer && d.status === 'locked') actions += `<button class="btn-action btn-action-paid" onclick="dealAction('${d.id}','paid')">I Paid RUB</button>`;
        if (isSeller && d.status === 'paid') actions += `<button class="btn-action btn-action-confirm" onclick="dealAction('${d.id}','release')">Confirm RUB Received</button>`;
        if ((isBuyer || isSeller) && (d.status === 'locked' || d.status === 'paid')) actions += `<button class="btn-action btn-action-dispute" onclick="dealAction('${d.id}','dispute')">Dispute</button>`;
        return `
            <div class="deal-card">
                <div class="deal-header">
                    <span>${isBuyer ? 'BUY from' : 'SELL to'} ${isBuyer ? d.seller_name : d.buyer_name}</span>
                    <span style="color:${statusColors[d.status]||'#8b949e'};font-weight:600;font-size:12px">${d.status.toUpperCase()}</span>
                </div>
                <div class="deal-amount">${Number(d.amount_usdt).toFixed(2)} USDT x ${(d.total_rub/d.amount_usdt).toFixed(2)} RUB</div>
                <div class="deal-info">Total: ${Number(d.total_rub).toLocaleString('ru')} RUB | ${d.payment_method||''}</div>
                ${d.escrow_tx_hash ? `<div class="deal-info" style="font-family:monospace;font-size:10px;color:#58a6ff;margin-top:4px">TX: ${d.escrow_tx_hash.slice(0,16)}...</div>` : ''}
                <div style="margin-top:6px">${actions}</div>
            </div>
        `;
    }).join('');
}

async function dealAction(dealId, action) {
    if (action === 'lock') {
        await lockDealWithUSDT(dealId);
        return;
    }
    const prompts = {
        paid: 'Confirm you have sent RUB to the seller?',
        release: 'Confirm you have received RUB on your account?',
        dispute: 'Reason for dispute:',
    };
    const value = action === 'dispute' ? prompt(prompts.dispute) : confirm(prompts[action]);

    if (!value) return;

    toast('Processing...');
    const data = await api('/deals/' + dealId + '/' + action, 'PUT', {
        tx_hash: undefined,
        reason: action === 'dispute' ? value : undefined,
        proof: action === 'paid' ? '' : undefined,
    });

    if (data) {
        toast(action.toUpperCase() + ' done!');
        loadMyDeals();
    }
}

async function lockDealWithUSDT(dealId) {
    const w = window._connectedWallet ? window._connectedWallet() : null;
    if (!w) {
        toast('Connect wallet first!');
        document.getElementById('connectModal')?.classList.add('active');
        return;
    }

    const deals = await api('/deals');
    const deal = deals?.find(d => d.id === dealId);
    if (!deal) return;

    toast('Opening wallet... Confirm the transaction.');
    const result = await window._sendUSDT(deal.amount_usdt, dealId);

    if (result?.success) {
        await api('/deals/' + dealId + '/lock', 'PUT', { tx_hash: result.txHash || 'confirmed' });
        toast('USDT sent! Deal LOCKED.');
        loadMyDeals();
    } else if (result?.signedUrl) {
        window.open(result.signedUrl, '_blank');
        toast('Complete transfer in your wallet, then come back and press Lock again.');
    }
}

// ========== PROFILE ==========
async function loadProfile() {
    if (!currentUser) return;
    const data = await api('/profile');
    if (!data) return;

    document.getElementById('profileSection').innerHTML = `
        <div class="profile-section">
            <h3 style="margin-bottom:12px">${data.username || 'User #' + data.id}</h3>
            <div class="stats-row">
                <div class="profile-stat"><div class="value">${data.deals_completed||0}</div><div class="label">Deals</div></div>
                <div class="profile-stat"><div class="value">${data.trust_score||0}</div><div class="label">Trust</div></div>
                <div class="profile-stat"><div class="value">${data.balance_frozen||0}</div><div class="label">Frozen</div></div>
            </div>
            <div class="wallet-label" style="margin-top:12px">TON Wallet</div>
            <input class="wallet-input" id="walletInput" value="${data.ton_wallet||''}" placeholder="Connects automatically via TON Connect">
            <button class="btn-primary" onclick="saveWallet()" style="width:100%">Save Wallet</button>
            <button class="btn-primary" onclick="document.getElementById('createOfferModal').classList.add('active')" style="width:100%;margin-top:8px;background:#1f6feb">Create Offer</button>
        </div>
    `;
}

async function saveWallet() {
    const wallet = document.getElementById('walletInput').value.trim();
    if (!wallet) { toast('Enter wallet address or use TON Connect'); return; }
    await api('/profile', 'PUT', { ton_wallet: wallet });
    toast('Wallet saved');
}

// Copy referral link
function copyReferralLink() {
    if (!currentUser) return;
    const link = 'https://t.me/SergGOrelyyBot?start=ref' + currentUser.id;
    navigator.clipboard?.writeText(link).then(() => toast('Link copied!')).catch(() => toast(link));
}

// Wallet
let walletOpen = false;
document.addEventListener('click', (e) => {
    if (e.target.id === 'balanceDisplay' && !walletOpen) { openWalletModal(); walletOpen = true; }
});

async function openWalletModal() {
    document.getElementById('walletModal').classList.add('active');
    document.getElementById('btnCloseWallet').onclick = () => { document.getElementById('walletModal').classList.remove('active'); walletOpen = false; };
    await refreshBalance();

    document.getElementById('btnDeposit').onclick = async () => {
        const txHash = document.getElementById('walletTxHash').value.trim();
        if (!txHash) { toast('Paste TX hash from your wallet'); return; }
        toast('Verifying on blockchain...');
        const r = await api('/wallet/deposit', 'POST', { tx_hash: txHash });
        if (r?.deposited) { toast('Deposited: ' + r.amount + ' USDT!'); await refreshBalance(); }
        else if (r?.status === 'pending') { toast(r.reason || 'Not found yet. Wait and try again.'); }
        else { toast(r?.error || 'Deposit failed'); }
    };

    document.getElementById('btnWithdraw').onclick = async () => {
        const amount = parseFloat(document.getElementById('walletAmount').value);
        const wallet = document.getElementById('walletRecipient').value.trim();
        if (!amount || amount <= 0) { toast('Enter amount'); return; }
        if (!wallet) { toast('Enter recipient wallet address'); return; }
        const r = await api('/wallet/withdraw', 'POST', { amount, wallet });
        if (r?.withdrawn) { toast('Withdrawn: ' + amount + ' USDT'); await refreshBalance(); }
        else { toast(r?.error || 'Withdraw failed'); }
    };
}

async function refreshBalance() {
    const r = await api('/wallet/balance');
    if (r) {
        document.getElementById('balanceDisplay').textContent = r.balance.toFixed(2) + ' USDT';
        document.getElementById('walletBalance').textContent = r.balance.toFixed(2) + ' USDT';
    }
}

// Auto-refresh balance
setInterval(refreshBalance, 10000);

// Charts & Live Rates
if (typeof TradingView !== 'undefined') {
    new TradingView.widget({
        container_id: "tradingview-widget",
        width: "100%", height: 300,
        symbol: "BINANCE:USDTUSDC",
        interval: "60",
        timezone: "Europe/Moscow",
        theme: "dark", style: "1", locale: "ru",
        toolbar_bg: "#161b22",
        enable_publishing: false,
        hide_side_toolbar: true,
        allow_symbol_change: false,
    });
}

async function loadLiveRates() {
    try {
        const rates = await api('/ton/rates');
        if (rates) {
            document.getElementById('rateDisplay').textContent = '1 TON = ' + (rates.tonRub || '500') + ' RUB | 1 USDT = ' + (rates.usdtRub || '92.5') + ' RUB';
        }
    } catch {}
}
