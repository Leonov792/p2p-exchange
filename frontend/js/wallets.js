// Wallet Connect v4 — Real exchange UX: click → wallet app → confirm → return → connected
// ===================================================================================
(function() {
    const API = 'https://p2p-exchange-api.vercel.app/api';
    const MANIFEST = 'https://p2p-exchange-sigma.vercel.app/tonconnect-manifest.json';
    const GUARANTOR = 'UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp';

    let connected = null;
    let tonConnectUI = null;

    function uid() { return localStorage.getItem('p2p_user_id') || (Math.floor(Math.random() * 900000) + 100000); }

    function toast(msg) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg; t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3500);
    }

    function updateUI(addr, bal) {
        const btn = document.getElementById('btnConnectWallet');
        const b = document.getElementById('balanceDisplay');
        if (btn) btn.textContent = addr;
        if (b && bal !== undefined) b.textContent = Number(bal || 0).toFixed(2) + ' USDT';
    }

    function saveAddress(addr, chain, label) {
        const short = chain === 'evm' ? addr.slice(0,6)+'...'+addr.slice(-4) : addr.slice(0,8)+'...'+addr.slice(-4);
        connected = { address: addr, chain, shortAddr: short, label };
        localStorage.setItem('p2p_wallet', JSON.stringify(connected));
        updateUI(short, 0);
        document.getElementById('btnConnectWallet')?.classList.add('connected');
        document.getElementById('connectModal')?.classList.remove('active');

        // Auto register + sync balance
        fetch(API + '/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-User-ID': String(uid()) },
            body: JSON.stringify({ id: uid(), username: label })
        }).then(() => {
            fetch(API + '/wallet/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Telegram-User-ID': String(uid()) },
                body: JSON.stringify({ address: addr, chain, balance: 0 })
            }).then(r => r.json()).then(d => {
                if (d?.balance !== undefined) updateUI(short, d.balance);
            }).catch(() => {});
        }).catch(() => {});

        toast('Connected: ' + label);
    }

    // ========== TON CONNECT with restoreConnection ==========
    async function initTON() {
        if (tonConnectUI) return tonConnectUI;
        if (typeof window.TonConnectUI === 'undefined') {
            console.log('TON Connect SDK not loaded');
            return null;
        }
        try {
            tonConnectUI = new window.TonConnectUI({ manifestUrl: MANIFEST });

            // Restore connection after return from wallet
            try {
                await tonConnectUI.restoreConnection();
                const w = tonConnectUI.wallet;
                if (w?.account?.address) {
                    saveAddress(w.account.address, 'ton', w.device?.appName || 'TON Wallet');
                }
            } catch(e) {
                console.log('No TON session to restore');
            }

            // Listen for new connections
            tonConnectUI.onStatusChange(function(w) {
                if (!w) return;
                const addr = w.account?.address;
                if (addr) saveAddress(addr, 'ton', w.device?.appName || 'TON Wallet');
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
                else connectFallback('TON', 'UQ');
            });
        }
    }

    // ========== EVM with sessionStorage recovery ==========
    function openEVM(wallet) {
        sessionStorage.setItem('pending_wallet', wallet);
        const links = {
            metamask: 'https://metamask.app.link/dapp/p2p-exchange-sigma.vercel.app',
            trustwallet: 'https://link.trustwallet.com/open_url?url=https://p2p-exchange-sigma.vercel.app',
            phantom: 'https://phantom.app/ul/browse/https://p2p-exchange-sigma.vercel.app',
        };
        window.location.href = links[wallet] || links.metamask;
    }

    async function recoverEVM() {
        const pending = sessionStorage.getItem('pending_wallet');
        if (!pending) return false;

        if (window.ethereum) {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts && accounts[0]) {
                    saveAddress(accounts[0], 'evm', pending === 'metamask' ? 'MetaMask' : pending === 'trustwallet' ? 'Trust Wallet' : 'Phantom');
                    sessionStorage.removeItem('pending_wallet');
                    return true;
                }
            } catch(e) {}
        }

        if (pending === 'phantom' && window.solana?.isPhantom) {
            try {
                const resp = await window.solana.connect();
                saveAddress(resp.publicKey.toString(), 'solana', 'Phantom');
                sessionStorage.removeItem('pending_wallet');
                return true;
            } catch(e) {}
        }

        sessionStorage.removeItem('pending_wallet');
        return false;
    }

    // ========== Telegram ==========
    function openTelegram() {
        const tg = window.Telegram?.WebApp;
        if (tg) {
            const u = tg.initDataUnsafe?.user;
            if (u) {
                saveAddress('tg:' + u.id, 'telegram', 'Telegram Wallet');
                return;
            }
            tg.openLink('https://t.me/wallet');
        }
        connectFallback('Telegram Wallet', 'UQ');
    }

    // ========== Phantom ==========
    function openPhantom() {
        openEVM('phantom');
    }

    // ========== Fallback ==========
    function connectFallback(label, prefix) {
        const addr = prompt('Paste your ' + label + ' address (' + prefix + '...):', '');
        if (addr) saveAddress(addr, 'ton', label);
    }

    // ========== Disconnect ==========
    async function disconnectAll() {
        connected = null;
        localStorage.removeItem('p2p_wallet');
        if (tonConnectUI) {
            try { await tonConnectUI.disconnect(); } catch(e) {}
        }
        document.getElementById('btnConnectWallet').textContent = 'Connect Wallet';
        document.getElementById('btnConnectWallet').classList.remove('connected');
        updateUI('0.00 USDT', 0);
        toast('Disconnected');
    }

    // ========== Send USDT ==========
    window._sendUSDT = async function(amount, dealId) {
        if (!connected) { toast('Connect wallet first.'); return null; }
        if (connected.chain === 'ton') {
            const r = await fetch(API + '/ton/transfer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: connected.address, amount, dealId })
            }).then(r => r.json());
            if (r?.deepLink) { window.location.href = r.deepLink; return { success: true, txHash: 'pending_' + Date.now() }; }
        }
        toast('Send ' + amount + ' USDT to ' + GUARANTOR.slice(0, 10) + '...');
        return null;
    };

    window._connectedWallet = function() { return connected; };

    // ========== INIT ==========
    document.addEventListener('DOMContentLoaded', async function() {
        const modal = document.getElementById('connectModal');
        const btn = document.getElementById('btnConnectWallet');
        if (!modal || !btn) return;

        // Restore saved session from localStorage
        try {
            const saved = JSON.parse(localStorage.getItem('p2p_wallet') || 'null');
            if (saved?.address) {
                connected = saved;
                btn.textContent = saved.shortAddr;
                btn.classList.add('connected');
                updateUI(saved.shortAddr, 0);
            }
        } catch {}

        // Try to restore TON Connect session after return from wallet
        initTON();

        // Try to recover EVM session after return from wallet
        recoverEVM();

        // Button click
        btn.onclick = function() {
            if (connected) { disconnectAll(); return; }
            modal.classList.add('active');
        };

        // Close modal
        document.getElementById('btnCancelConnect')?.addEventListener('click', function() {
            modal.classList.remove('active');
        });
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.classList.remove('active');
        });

        // Wallet click handlers
        var handlers = {
            tonkeeper: openTONWallet,
            tonhub: openTONWallet,
            mytonwallet: openTONWallet,
            metamask: function() { openEVM('metamask'); },
            trustwallet: function() { openEVM('trustwallet'); },
            phantom: openPhantom,
            telegram: openTelegram,
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
