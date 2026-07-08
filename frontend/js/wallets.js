// Wallet Connect v5 — Real exchange UX: click wallet → connect → return → auto-connected
// ===================================================================================
(function() {
    var API = '/api';
    var MANIFEST = 'https://p2p-exchange-sigma.vercel.app/tonconnect-manifest.json';
    var GUARANTOR = 'UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp';

    var connected = null;
    var tonConnectUI = null;

    function uid() {
        var id = localStorage.getItem('p2p_user_id');
        if (!id) { id = String(Math.floor(Math.random() * 900000) + 100000); localStorage.setItem('p2p_user_id', id); }
        return id;
    }

    function toast(msg) {
        var t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg; t.classList.add('show');
        setTimeout(function() { t.classList.remove('show'); }, 3500);
    }

    function updateUI(addr, bal) {
        var btn = document.getElementById('btnConnectWallet');
        var b = document.getElementById('balanceDisplay');
        if (btn) btn.textContent = addr;
        if (b && bal !== undefined) b.textContent = Number(bal || 0).toFixed(2) + ' USDT';
    }

    function syncBalance(addr, chain) {
        fetch(API + '/wallet/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-User-ID': String(uid()) },
            body: JSON.stringify({ address: addr, chain: chain, balance: 0 })
        }).then(function(r) { return r.json(); }).then(function(d) {
            if (d && d.balance !== undefined) updateUI(connected.shortAddr, d.balance);
        }).catch(function() {});
    }

    function saveAddress(addr, chain, label) {
        var short;
        if (chain === 'evm') short = addr.slice(0, 6) + '...' + addr.slice(-4);
        else if (chain === 'solana') short = addr.slice(0, 6) + '...' + addr.slice(-4);
        else short = addr.slice(0, 8) + '...' + addr.slice(-4);

        connected = { address: addr, chain: chain, shortAddr: short, label: label };
        localStorage.setItem('p2p_wallet', JSON.stringify(connected));

        updateUI(short, 0);
        var btn = document.getElementById('btnConnectWallet');
        if (btn) btn.classList.add('connected');

        var modal = document.getElementById('connectModal');
        if (modal) modal.classList.remove('active');

        hideEVMRecovery();

        fetch(API + '/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-User-ID': String(uid()) },
            body: JSON.stringify({ id: uid(), username: label })
        }).then(function() {
            syncBalance(addr, chain);
        }).catch(function() {});

        toast('Connected: ' + label);
    }

    // ===================== TON CONNECT =====================
    async function initTON() {
        if (tonConnectUI) return tonConnectUI;
        if (typeof window.TonConnectUI === 'undefined') {
            console.log('TON Connect SDK not loaded');
            return null;
        }
        try {
            tonConnectUI = new window.TonConnectUI({ manifestUrl: MANIFEST });

            try {
                await tonConnectUI.restoreConnection();
                var w = tonConnectUI.wallet;
                if (w && w.account && w.account.address) {
                    saveAddress(w.account.address, 'ton', w.device.appName || 'TON Wallet');
                }
            } catch(e) {
                console.log('No TON session to restore');
            }

            tonConnectUI.onStatusChange(function(w) {
                if (!w) return;
                var addr = w.account && w.account.address;
                if (addr) saveAddress(addr, 'ton', (w.device && w.device.appName) || 'TON Wallet');
            });

            return tonConnectUI;
        } catch(e) {
            console.error('TON Connect init:', e.message);
            return null;
        }
    }

    function openTONWallet() {
        if (tonConnectUI) {
            tonConnectUI.connectWallet();
        } else {
            initTON().then(function(sdk) {
                if (sdk) sdk.connectWallet();
                else toast('TON Connect failed. Try again.');
            });
        }
    }

    // ===================== EVM RECOVERY =====================
    function showEVMRecovery(wallet, chain) {
        var walletGrid = document.getElementById('walletGrid');
        var recovery = document.getElementById('evmRecoveryBlock');
        var msg = document.getElementById('evmRecoveryMsg');
        var input = document.getElementById('evmRecoveryInput');
        var error = document.getElementById('evmRecoveryError');
        var connectStatus = document.getElementById('connectStatus');

        if (!walletGrid || !recovery) return;

        var labels = { metamask: 'MetaMask', trustwallet: 'Trust Wallet', phantom: 'Phantom' };
        var label = labels[wallet] || wallet;
        var placeholderText = wallet === 'phantom' ? 'Solana base58...' : '0x...';

        msg.textContent = 'Returned from ' + label + '? Paste your address:';
        input.placeholder = placeholderText;
        input.value = '';
        if (error) error.style.display = 'none';
        if (connectStatus) connectStatus.textContent = '';

        walletGrid.style.display = 'none';
        recovery.style.display = 'block';

        var modal = document.getElementById('connectModal');
        if (modal) modal.classList.add('active');

        document.getElementById('btnEVMConfirm').onclick = function() {
            var addr = input.value.trim();
            if (!addr) return;
            var isValid = false;

            if (chain === 'evm' && /^0x[a-fA-F0-9]{40}$/.test(addr)) isValid = true;
            if (chain === 'solana' && addr.length >= 32) isValid = true;

            if (!isValid) {
                if (error) { error.textContent = 'Invalid ' + label + ' address format'; error.style.display = 'block'; }
                return;
            }

            sessionStorage.removeItem('pending_wallet');
            saveAddress(addr, chain, label);
        };

        document.getElementById('btnEVMBack').onclick = function() {
            hideEVMRecovery();
        };
    }

    function hideEVMRecovery() {
        var walletGrid = document.getElementById('walletGrid');
        var recovery = document.getElementById('evmRecoveryBlock');
        if (walletGrid) walletGrid.style.display = '';
        if (recovery) recovery.style.display = 'none';
    }

    // ===================== EVM WALLETS =====================
    function openEVM(wallet) {
        sessionStorage.setItem('pending_wallet', wallet);
        var links = {
            metamask: 'https://metamask.app.link/dapp/p2p-exchange-sigma.vercel.app',
            trustwallet: 'https://link.trustwallet.com/open_url?url=https://p2p-exchange-sigma.vercel.app',
            phantom: 'https://phantom.app/ul/browse/https://p2p-exchange-sigma.vercel.app'
        };
        window.location.href = links[wallet] || links.metamask;
    }

    function recoverEVM() {
        var pending = sessionStorage.getItem('pending_wallet');
        if (!pending) return;

        var chain = pending === 'phantom' ? 'solana' : 'evm';
        showEVMRecovery(pending, chain);
    }

    // ===================== TELEGRAM =====================
    function openTelegram() {
        var tg = window.Telegram && window.Telegram.WebApp;
        if (tg) {
            var u = tg.initDataUnsafe && tg.initDataUnsafe.user;
            if (u) {
                saveAddress('tg:' + u.id, 'telegram', 'Telegram Wallet');
                return;
            }
            tg.openLink('https://t.me/wallet');
        } else {
            toast('Open this app in Telegram');
        }
    }

    // ===================== DISCONNECT =====================
    function disconnectAll() {
        connected = null;
        localStorage.removeItem('p2p_wallet');
        sessionStorage.removeItem('pending_wallet');
        if (tonConnectUI) {
            try { tonConnectUI.disconnect(); } catch(e) {}
        }
        var btn = document.getElementById('btnConnectWallet');
        if (btn) { btn.textContent = 'Connect Wallet'; btn.classList.remove('connected'); }
        updateUI('0.00 USDT', 0);
        toast('Disconnected');
    }

    // ===================== SEND USDT =====================
    window._sendUSDT = async function(amount, dealId) {
        if (!connected) { toast('Connect wallet first.'); return null; }
        if (connected.chain === 'ton') {
            var r = await fetch(API + '/ton/transfer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: connected.address, amount: amount, dealId: dealId })
            }).then(function(r) { return r.json(); });
            if (r && r.deepLink) { window.location.href = r.deepLink; return { success: true, txHash: 'pending_' + Date.now() }; }
        }
        toast('Send ' + amount + ' USDT to ' + GUARANTOR.slice(0, 10) + '...');
        return null;
    };

    window._connectedWallet = function() { return connected; };

    // ===================== INIT =====================
    document.addEventListener('DOMContentLoaded', function() {
        var modal = document.getElementById('connectModal');
        var btn = document.getElementById('btnConnectWallet');
        if (!modal || !btn) return;

        // Restore from localStorage
        try {
            var saved = JSON.parse(localStorage.getItem('p2p_wallet') || 'null');
            if (saved && saved.address) {
                connected = saved;
                btn.textContent = saved.shortAddr;
                btn.classList.add('connected');
                syncBalance(saved.address, saved.chain);
            }
        } catch(e) {}

        // TON session restore
        initTON();

        // EVM recovery after returning from wallet
        recoverEVM();

        // Button: toggle modal / disconnect
        btn.onclick = function() {
            if (connected) { disconnectAll(); return; }
            hideEVMRecovery();
            modal.classList.add('active');
        };

        // Close modal
        document.getElementById('btnCancelConnect').addEventListener('click', function() {
            modal.classList.remove('active');
            hideEVMRecovery();
        });
        modal.addEventListener('click', function(e) {
            if (e.target === modal) { modal.classList.remove('active'); hideEVMRecovery(); }
        });

        // Wallet grid clicks
        var handlers = {
            tonkeeper: openTONWallet,
            tonhub: openTONWallet,
            mytonwallet: openTONWallet,
            metamask: function() { openEVM('metamask'); },
            trustwallet: function() { openEVM('trustwallet'); },
            phantom: function() { openEVM('phantom'); },
            telegram: openTelegram
        };

        document.getElementById('walletGrid').addEventListener('click', function(e) {
            var item = e.target.closest('.wallet-item');
            if (!item) return;
            var wallet = item.dataset.wallet;
            var fn = handlers[wallet];
            if (fn) fn();
        });
    });
})();
