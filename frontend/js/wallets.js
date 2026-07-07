// Wallet Connect — All 7 Wallets (fixed)
// ============================================
(function() {
    const API = 'https://p2p-exchange-api.vercel.app/api';
    let connected = null;

    function apiCall(path, method = 'GET', body = null) {
        const h = { 'Content-Type': 'application/json' };
        const uid = localStorage.getItem('p2p_user_id') || '';
        if (uid) h['X-Telegram-User-ID'] = uid;
        try { return fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : null }).then(r => r.json()); } catch { return null; }
    }

    function toast(msg) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg; t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    function setStatus(text) { const el = document.getElementById('connectStatus'); if (el) el.textContent = text; }

    function updateUI(shortAddr, balance) {
        const btn = document.getElementById('btnConnectWallet');
        const bal = document.getElementById('balanceDisplay');
        if (btn) btn.textContent = shortAddr;
        if (bal && balance !== undefined) bal.textContent = Number(balance).toFixed(2) + ' USDT';
    }

    // ========== INIT ==========
    document.addEventListener('DOMContentLoaded', function() {
        const modal = document.getElementById('connectModal');
        const btn = document.getElementById('btnConnectWallet');
        const cancel = document.getElementById('btnCancelConnect');
        if (!modal || !btn) return;

        btn.onclick = function() {
            if (connected) { connected = null; btn.textContent = 'Connect Wallet'; btn.classList.remove('connected'); updateUI('0.00 USDT', 0); return; }
            modal.classList.add('active');
        };
        cancel.onclick = function() { modal.classList.remove('active'); };
        modal.addEventListener('click', function(e) { if (e.target === modal) modal.classList.remove('active'); });

        document.getElementById('walletGrid').addEventListener('click', async function(e) {
            const item = e.target.closest('.wallet-item');
            if (!item) return;
            const wallet = item.dataset.wallet;
            item.classList.add('connecting');
            setStatus('Connecting to ' + wallet + '...');

            let result = null;
            try {
                if (wallet === 'tonkeeper' || wallet === 'tonhub' || wallet === 'mytonwallet') {
                    result = await connectTON(wallet);
                } else if (wallet === 'metamask' || wallet === 'trustwallet') {
                    result = await connectEVM(wallet);
                } else if (wallet === 'phantom') {
                    result = await connectPhantomReal();
                } else if (wallet === 'telegram') {
                    result = await connectTelegram();
                }
            } catch(e) { console.error(wallet, e); }

            item.classList.remove('connecting');
            if (result) {
                item.classList.add('connected');
                connected = result;
                updateUI(result.shortAddr, result.balance || 0);
                btn.classList.add('connected');
                modal.classList.remove('active');
                toast('Connected: ' + (result.label || wallet));
            } else {
                setStatus('Not found. Open ' + wallet + ' app first.');
            }
        });
    });

    // ========== TON WALLETS ==========
    async function connectTON(app) {
        const dappUrl = 'https://p2p-exchange-sigma.vercel.app';
        setStatus('Opening ' + app + '...');
        if (app === 'tonkeeper') window.open('https://app.tonkeeper.com/ton-login?url=' + encodeURIComponent(dappUrl), '_blank');
        else if (app === 'tonhub') window.open('https://tonhub.com/ton-connect/?' + encodeURIComponent(dappUrl), '_blank');
        else window.open('https://mytonwallet.app/ton-connect?url=' + encodeURIComponent(dappUrl), '_blank');

        const addr = prompt('Enter your TON wallet address (starts with UQ):', '');
        if (!addr || !addr.startsWith('UQ')) return null;

        await apiCall('/wallet/sync', 'POST', { address: addr, chain: 'ton', balance: 0 });
        return { address: addr, chain: 'ton', shortAddr: addr.slice(0,8)+'...'+addr.slice(-4), label: app, balance: 0 };
    }

    // ========== EVM WALLETS ==========
    async function connectEVM(wallet) {
        if (window.ethereum) {
            try {
                setStatus('Requesting ' + wallet + '...');
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                if (accounts && accounts[0]) {
                    const addr = accounts[0];
                    await apiCall('/wallet/sync', 'POST', { address: addr, chain: 'evm', balance: 0 });
                    return { address: addr, chain: 'evm', shortAddr: addr.slice(0,6)+'...'+addr.slice(-4), label: wallet, balance: 0 };
                }
            } catch(e) { console.error(wallet, e); }
        }
        setStatus(wallet + ' not detected. Opening app...');
        if (wallet === 'metamask') window.open('https://metamask.app.link/dapp/p2p-exchange-sigma.vercel.app', '_blank');
        else window.open('https://link.trustwallet.com/open_url?url=https://p2p-exchange-sigma.vercel.app', '_blank');

        const addr = prompt('Paste your ' + wallet + ' address (0x...):', '');
        if (!addr || !addr.startsWith('0x')) return null;
        await apiCall('/wallet/sync', 'POST', { address: addr, chain: 'evm', balance: 0 });
        return { address: addr, chain: 'evm', shortAddr: addr.slice(0,6)+'...'+addr.slice(-4), label: wallet, balance: 0 };
    }

    // ========== PHANTOM (Solana + EVM) ==========
    async function connectPhantomReal() {
        setStatus('Detecting Phantom...');

        if (window.solana && window.solana.isPhantom) {
            try {
                const resp = await window.solana.connect();
                const addr = resp.publicKey.toString();
                await apiCall('/wallet/sync', 'POST', { address: addr, chain: 'solana', balance: 0 });
                return { address: addr, chain: 'solana', shortAddr: addr.slice(0,8)+'...'+addr.slice(-4), label: 'Phantom', balance: 0 };
            } catch(e) {}
        }

        if (window.ethereum) {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                if (accounts && accounts[0]) {
                    const addr = accounts[0];
                    await apiCall('/wallet/sync', 'POST', { address: addr, chain: 'evm', balance: 0 });
                    return { address: addr, chain: 'evm', shortAddr: addr.slice(0,6)+'...'+addr.slice(-4), label: 'Phantom', balance: 0 };
                }
            } catch(e) {}
        }

        window.open('https://phantom.app/ul/browse/' + encodeURIComponent('https://p2p-exchange-sigma.vercel.app'), '_blank');
        setStatus('Open Phantom browser and return...');

        const addr = prompt('Paste your Phantom address (Solana or 0x...):', '');
        if (!addr) return null;
        const chain = addr.startsWith('0x') ? 'evm' : 'solana';
        await apiCall('/wallet/sync', 'POST', { address: addr, chain, balance: 0 });
        return { address: addr, chain, shortAddr: addr.slice(0,8)+'...'+addr.slice(-4), label: 'Phantom', balance: 0 };
    }

    // ========== TELEGRAM WALLET ==========
    async function connectTelegram() {
        const tg = window.Telegram?.WebApp;
        if (tg) {
            window.open('https://t.me/wallet', '_blank');
            const uid = tg.initDataUnsafe?.user?.id || Date.now();
            return { address: 'tg:' + uid, chain: 'telegram', shortAddr: 'TG:' + String(uid).slice(-6), label: 'Telegram', balance: 0 };
        }
        window.open('https://t.me/wallet', '_blank');
        const addr = prompt('Enter your Telegram Wallet TON address:', '');
        if (!addr) return null;
        return { address: addr, chain: 'ton', shortAddr: addr.slice(0,8)+'...'+addr.slice(-4), label: 'Telegram', balance: 0 };
    }

    // ========== SEND USDT ==========
    window._sendUSDT = async function(amount, dealId) {
        if (!connected) { toast('Connect wallet first.'); return null; }

        if (connected.chain === 'ton' || connected.chain === 'telegram') {
            const transfer = await apiCall('/ton/transfer', 'POST', { sender: connected.address, amount, dealId });
            if (transfer?.deepLink) {
                window.location.href = transfer.deepLink;
                return { success: true, txHash: 'pending_' + Date.now(), signedUrl: transfer.deepLink };
            }
        }

        if (connected.chain === 'evm' && window.ethereum) {
            try {
                const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
                const to = '0x0000000000000000000000000000000000000000';
                const valueHex = '0x' + Math.floor(amount * 1e6).toString(16);
                const data = '0xa9059cbb' + to.slice(2).padStart(64,'0') + valueHex.slice(2).padStart(64,'0');
                const txHash = await window.ethereum.request({
                    method: 'eth_sendTransaction',
                    params: [{ from: connected.address, to: USDT, data, gas: '0x186A0' }]
                });
                return { success: true, txHash };
            } catch(e) { toast('Transaction rejected.'); return null; }
        }

        toast('Send ' + amount + ' USDT to guarantor: UQAAECd3lx...');
        return null;
    };

    window._connectedWallet = function() { return connected; };
})();
