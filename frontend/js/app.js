// P2P Exchange v3 — Core Logic
// ============================================
'use strict';

let currentUser = null;

function getTG() { return window.Telegram && window.Telegram.WebApp; }

function getAuthHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    var tg = getTG();
    if (tg && tg.initData) {
        headers['X-Telegram-InitData'] = tg.initData;
        headers['X-Telegram-User-Id'] = String(currentUser ? currentUser.id : (tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : ''));
    } else if (currentUser) {
        headers['X-Telegram-User-Id'] = String(currentUser.id);
    }
    return headers;
}

function uid() {
    var id = localStorage.getItem('p2p_user_id');
    if (!id) { id = String(Math.floor(Math.random() * 900000) + 100000); localStorage.setItem('p2p_user_id', id); }
    return id;
}

function toast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    setTimeout(function() { t.classList.remove('show'); }, 3000);
}

async function api(path, method, body) {
    method = method || 'GET';
    var opts = { method: method, headers: getAuthHeaders() };
    if (body) opts.body = JSON.stringify(body);
    try {
        var res = await fetch('/api' + path, opts);
        var data = await res.json();
        if (!res.ok) { toast(data.error || res.status); return null; }
        return data;
    } catch (e) { toast('Network error'); return null; }
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', function() {
    var tg = getTG();
    if (tg) { try { tg.ready(); tg.expand(); } catch(e) {} }
    initAuth();
    updateBalanceDisplay();
    setInterval(updateBalanceDisplay, 30000);
});

async function initAuth() {
    var tg = getTG();
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        var u = tg.initDataUnsafe.user;
        currentUser = { id: u.id, username: u.username, first_name: u.first_name };
        await api('/auth', 'POST', { id: u.id, username: u.username || '' });
        updateWalletButton(u.username || u.first_name || 'User');
    } else {
        var storedId = localStorage.getItem('p2p_user_id');
        var uId = storedId ? parseInt(storedId) : (Math.floor(Math.random() * 900000) + 100000);
        localStorage.setItem('p2p_user_id', String(uId));
        currentUser = { id: uId, username: 'trader_' + uId };
        await api('/auth', 'POST', { id: uId, username: 'trader_' + uId });
        updateWalletButton('trader_' + uId);
    }
}

function updateWalletButton(label) {
    var btn = document.getElementById('btnConnectWallet');
    if (!btn) return;
    var short = String(label).substring(0, 10);
    btn.querySelector('.addr').textContent = short;
    btn.classList.remove('not-connected');
}

async function updateBalanceDisplay() {
    try {
        var d = await api('/wallet/balance');
        if (d && d.available !== undefined) {
            document.getElementById('hdrBalance').textContent = parseFloat(d.available).toFixed(2);
        }
    } catch(e) {}
}

// Wallet connect modal toggle
window.toggleConnectModal = function() {
    var m = document.getElementById('connectModal');
    m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
};
