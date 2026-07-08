// Wallet Connect v6 — Real TON Connect with Jetton Transfers
// =========================================================================
(function() {
    var API = '/api';
    var MANIFEST = 'https://p2p-exchange-sigma.vercel.app/tonconnect-manifest.json';
    var GUARANTOR = 'UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp';
    var USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

    var connected = null;
    var tonConnectUI = null;

    function uid() {
        var id = localStorage.getItem('p2p_user_id');
        if (!id) { id = String(Math.floor(Math.random() * 900000) + 100000); localStorage.setItem('p2p_user_id', id); }
        return id;
    }

    function toast(msg) {
        var t = document.getElementById('toast'); if (!t) return;
        t.textContent = msg; t.classList.add('show');
        setTimeout(function() { t.classList.remove('show'); }, 3500);
    }

    function updateUI(addr, bal) {
        var btn = document.getElementById('btnConnectWallet');
        if (btn) { btn.textContent = addr; btn.classList.add('connected'); btn.classList.remove('not-connected'); btn.querySelector('.addr').textContent = addr; btn.querySelector('.dot').style.background = 'var(--green)'; }
        if (bal !== undefined) document.getElementById('hdrBalance').textContent = Number(bal||0).toFixed(2);
    }

    function saveAddress(addr, chain, label) {
        var short = chain === 'ton' ? addr.slice(0,8)+'...'+addr.slice(-4) : addr.slice(0,6)+'...'+addr.slice(-4);
        connected = { address: addr, chain: chain, shortAddr: short, label: label };
        localStorage.setItem('p2p_wallet', JSON.stringify(connected));
        updateUI(short, 0);

        var modal = document.getElementById('connectModal');
        if (modal) modal.style.display = 'none';

        fetch(API + '/auth', { method:'POST', headers:{'Content-Type':'application/json','X-Telegram-User-Id':String(uid())}, body:JSON.stringify({id:uid(),username:label}) })
            .then(function() { syncBalance(addr, chain); }).catch(function() {});
        toast('Connected: ' + label);
    }

    function syncBalance(addr, chain) {
        fetch(API + '/wallet/sync', { method:'POST', headers:{'Content-Type':'application/json','X-Telegram-User-Id':String(uid())}, body:JSON.stringify({address:addr,chain:chain,balance:0}) })
            .then(function(r) { return r.json(); }).then(function(d) {
                if (d && d.balance !== undefined) { updateUI(connected.shortAddr, d.balance); }
            }).catch(function() {});
    }

    // ===================== TON CONNECT =====================
    async function initTON() {
        if (tonConnectUI) return tonConnectUI;
        if (typeof window.TonConnectUI === 'undefined') { console.log('TON SDK not loaded'); return null; }
        try {
            tonConnectUI = new window.TonConnectUI({ manifestUrl: MANIFEST, actionsConfiguration: { twaReturnUrl: 'https://t.me/SergGOrelyyBot' } });
            try {
                await tonConnectUI.restoreConnection();
                var w = tonConnectUI.wallet;
                if (w && w.account && w.account.address) {
                    saveAddress(w.account.address, 'ton', w.device && w.device.appName || 'TON Wallet');
                }
            } catch(e) { console.log('No TON session'); }
            tonConnectUI.onStatusChange(function(w) {
                if (!w) return;
                var addr = w.account && w.account.address;
                if (addr) saveAddress(addr, 'ton', (w.device && w.device.appName) || 'TON Wallet');
            });
            return tonConnectUI;
        } catch(e) { console.error('TON init:', e.message); return null; }
    }

    function openTONWallet() {
        if (tonConnectUI) { tonConnectUI.connectWallet(); }
        else { initTON().then(function(sdk) { if (sdk) sdk.connectWallet(); else toast('TON Connect failed'); }); }
    }

    // ===================== REAL JETTON TRANSFER =====================
    window._sendJetton = async function(recipient, amount, comment) {
        if (!connected || connected.chain !== 'ton') { toast('Connect TON wallet first'); return null; }
        if (!tonConnectUI) {
            var sdk = await initTON();
            if (!sdk) { toast('TON Connect not available'); return null; }
        }
        try {
            var r = await fetch(API + '/ton/transfer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Telegram-User-Id': String(uid()) },
                body: JSON.stringify({ sender: connected.address, amount: String(amount), dealId: comment || '', recipient: recipient })
            }).then(function(r) { return r.json(); });

            if (r.error) { toast(r.error); return null; }

            var messages = [{
                address: recipient || GUARANTOR,
                amount: String(Math.round(parseFloat(amount || 0) * 100) * 1000000), // USDT * 100 → nano
                payload: r.jettonPayload || r.payload
            }];

            toast('Confirm transaction in your wallet...');
            var result = await tonConnectUI.sendTransaction({ validUntil: Math.floor(Date.now()/1000) + 300, messages: messages });
            var boc = result && result.boc;
            if (boc) {
                await fetch(API + '/ton/verify', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-User-Id': String(uid()) },
                    body: JSON.stringify({ sender: connected.address, amount: String(amount), dealId: comment, boc: boc })
                });
                toast('Transaction sent! TX: ' + (boc||'').substring(0, 12) + '...');
                return { success: true, txHash: boc, boc: boc };
            }
            toast('Transaction cancelled or failed');
            return null;
        } catch(e) {
            if (e && e.message && e.message.includes('rejected')) { toast('Transaction rejected'); return null; }
            toast('Send error: ' + (e && e.message || 'unknown'));
            return null;
        }
    };

    // Legacy _sendUSDT — now uses real jetton transfer
    window._sendUSDT = async function(amount, dealId) {
        return window._sendJetton(GUARANTOR, amount, 'DEAL_' + (dealId||'').substring(0, 8));
    };

    // ===================== DEPOSIT / WITHDRAW =====================
    window._scanDeposit = async function() {
        if (!connected) { toast('Connect wallet first'); return; }
        toast('Scanning TON blockchain...');
        try {
            var r = await fetch(API + '/deposit/scan?address=' + encodeURIComponent(connected.address), {
                headers: { 'X-Telegram-User-Id': String(uid()) }
            }).then(function(r) { return r.json(); });
            if (r && r.found) {
                toast('Deposit found: ' + r.amount + ' ' + r.asset);
                syncBalance(connected.address, connected.chain);
            } else {
                toast(r && r.message || 'No new deposits found');
            }
            return r;
        } catch(e) { toast('Scan error'); return null; }
    };

    window._requestWithdrawal = async function(amount, recipient, asset) {
        if (!connected) { toast('Connect wallet first'); return null; }
        try {
            var r = await fetch(API + '/withdraw/request', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-User-Id': String(uid()) },
                body: JSON.stringify({ amount: String(amount), recipient: recipient, asset: asset || 'USDT' })
            }).then(function(r) { return r.json(); });
            if (r && r.withdrawal_id) {
                toast('Withdrawal queued: ' + r.withdrawal_id.substring(0, 8));
            } else if (r && r.error) {
                toast(r.error);
            }
            return r;
        } catch(e) { toast('Withdrawal error'); return null; }
    };

    window._connectedWallet = function() { return connected; };

    // ===================== EVM WALLETS =====================
    function openEVM(wallet) {
        sessionStorage.setItem('pending_wallet', wallet);
        var links = { metamask: 'https://metamask.app.link/dapp/p2p-exchange-sigma.vercel.app', trustwallet: 'https://link.trustwallet.com/open_url?url=https://p2p-exchange-sigma.vercel.app', phantom: 'https://phantom.app/ul/browse/https://p2p-exchange-sigma.vercel.app' };
        window.location.href = links[wallet] || links.metamask;
    }

    function recoverEVM() {
        var pending = sessionStorage.getItem('pending_wallet');
        if (!pending) return;
        var chain = pending === 'phantom' ? 'solana' : 'evm';
        showEVMRecovery(pending, chain);
    }

    function showEVMRecovery(wallet, chain) {
        var addr = prompt('Returned from ' + wallet + '? Paste your wallet address:');
        if (!addr) return;
        sessionStorage.removeItem('pending_wallet');
        var labels = { metamask:'MetaMask', trustwallet:'Trust Wallet', phantom:'Phantom' };
        saveAddress(addr, chain, labels[wallet]||wallet);
    }

    function openTelegram() {
        var tg = window.Telegram && window.Telegram.WebApp;
        if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
            saveAddress('tg:' + tg.initDataUnsafe.user.id, 'telegram', 'Telegram Wallet');
        } else { toast('Open in Telegram'); }
    }

    function disconnectAll() {
        connected = null;
        localStorage.removeItem('p2p_wallet');
        sessionStorage.removeItem('pending_wallet');
        if (tonConnectUI) { try { tonConnectUI.disconnect(); } catch(e) {} }
        var btn = document.getElementById('btnConnectWallet');
        if (btn) { btn.textContent = 'Connect Wallet'; btn.classList.add('not-connected'); btn.classList.remove('connected'); }
        document.getElementById('hdrBalance').textContent = '0.00';
        toast('Disconnected');
    }

    // ===================== INIT =====================
    document.addEventListener('DOMContentLoaded', function() {
        var modal = document.getElementById('connectModal');
        var btn = document.getElementById('btnConnectWallet');
        if (!modal || !btn) return;

        try {
            var saved = JSON.parse(localStorage.getItem('p2p_wallet') || 'null');
            if (saved && saved.address) {
                connected = saved;
                updateUI(saved.shortAddr, 0);
                syncBalance(saved.address, saved.chain);
            }
        } catch(e) {}

        initTON();
        recoverEVM();

        btn.onclick = function() {
            if (connected) { disconnectAll(); return; }
            modal.style.display = 'flex';
        };

        document.getElementById('btnCancelConnect') && document.getElementById('btnCancelConnect').addEventListener('click', function() { modal.style.display = 'none'; });

        var handlers = { tonkeeper:openTONWallet, tonhub:openTONWallet, mytonwallet:openTONWallet, metamask:function(){openEVM('metamask');}, trustwallet:function(){openEVM('trustwallet');}, phantom:function(){openEVM('phantom');}, telegram:openTelegram };

        var grid = document.getElementById('walletGrid');
        if (grid) {
            grid.innerHTML = ['tonkeeper','tonhub','mytonwallet','telegram','metamask','trustwallet','phantom'].map(function(k) {
                var icons = { tonkeeper:{c:'#0088CC',t:'T'}, tonhub:{c:'#0066FF',t:'H'}, mytonwallet:{c:'#00A3FF',t:'M'}, telegram:{c:'#2AABEE',t:'TG'}, metamask:{c:'#F6851B',t:'Fx'}, trustwallet:{c:'#3375BB',t:'TW'}, phantom:{c:'#AB9FF2',t:'P'} };
                var ic = icons[k];
                return '<div class="wallet-item" data-wallet="' + k + '"><div class="wallet-icon" style="background:' + ic.c + '">' + ic.t + '</div><span>' + k + '</span></div>';
            }).join('');
            grid.addEventListener('click', function(e) {
                var item = e.target.closest('.wallet-item');
                if (!item) return;
                var fn = handlers[item.dataset.wallet];
                if (fn) fn();
            });
        }
    });
})();
