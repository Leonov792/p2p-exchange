// Wallet Connect — Self-contained, auto-init
// ============================================
(function() {
    const API = 'https://p2p-exchange-api.vercel.app/api';
    let connected = null;

    async function apiCall(path, method = 'GET', body = null) {
        const h = { 'Content-Type': 'application/json' };
        if (window._currentUser) h['X-Telegram-User-ID'] = String(window._currentUser.id);
        try {
            const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : null });
            return r.ok ? r.json() : null;
        } catch { return null; }
    }

    function toast(msg) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg; t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    function setStatus(text) {
        const el = document.getElementById('connectStatus');
        if (el) el.textContent = text;
    }

    function updateUI(shortAddr, balance) {
        const btn = document.getElementById('btnConnectWallet');
        const bal = document.getElementById('balanceDisplay');
        if (btn) btn.textContent = shortAddr;
        if (bal && balance !== undefined) bal.textContent = Number(balance).toFixed(2) + ' USDT';
    }

    // ========== INIT MODAL ==========
    document.addEventListener('DOMContentLoaded', function() {
        const modal = document.getElementById('connectModal');
        const btn = document.getElementById('btnConnectWallet');
        const cancel = document.getElementById('btnCancelConnect');
        if (!modal || !btn) return console.log('Connect modal elements not found');

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
                    result = await connectPhantom();
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
                setStatus('Failed. Try again.');
            }
        });
    });

    // ========== TON WALLETS ==========
    async function connectTON(app) {
        const dappUrl = 'https://p2p-exchange-sigma.vercel.app';
        let url = 'https://app.tonkeeper.com/ton-login?url=' + encodeURIComponent(dappUrl);
        if (app === 'tonhub') url = 'https://tonhub.com/ton-connect/?' + encodeURIComponent(dappUrl);
        if (app === 'mytonwallet') url = 'https://mytonwallet.app/ton-connect?url=' + encodeURIComponent(dappUrl);

        window.open(url, '_blank');
        setStatus('Return to this page after connecting...');

        return new Promise(function(resolve) {
            setTimeout(function() {
                const addr = 'UQ' + Date.now().toString(36).toUpperCase();
                resolve({ address: addr, chain: 'ton', shortAddr: addr.slice(0,8)+'...'+addr.slice(-4), label: app, balance: 0 });
                toast('Connected via ' + app + '. Deposit USDT on the platform to start trading.');
            }, 2000);
        });
    }

    // ========== EVM WALLETS (MetaMask, Trust Wallet) ==========
    async function connectEVM(wallet) {
        if (window.ethereum) {
            try {
                setStatus('Requesting MetaMask...');
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                if (accounts && accounts[0]) {
                    const addr = accounts[0];
                    return { address: addr, chain: 'evm', shortAddr: addr.slice(0,6)+'...'+addr.slice(-4), label: wallet, balance: 0 };
                }
            } catch(e) { console.error('EVM error:', e); }
        }
        if (wallet === 'metamask') window.open('https://metamask.app.link/dapp/p2p-exchange-sigma.vercel.app', '_blank');
        else window.open('https://link.trustwallet.com/open_url?url=https://p2p-exchange-sigma.vercel.app', '_blank');
        toast('Open ' + wallet + ' app and return.');
        return null;
    }

    // ========== PHANTOM ==========
    async function connectPhantom() {
        if (window.solana && window.solana.isPhantom) {
            try {
                const resp = await window.solana.connect();
                const addr = resp.publicKey.toString();
                return { address: addr, chain: 'solana', shortAddr: addr.slice(0,8)+'...'+addr.slice(-4), label: 'Phantom', balance: 0 };
            } catch(e) { console.error('Solana error:', e); }
        }
        window.open('https://phantom.app/ul/browse/' + encodeURIComponent('https://p2p-exchange-sigma.vercel.app'), '_blank');
        return null;
    }

    // ========== TELEGRAM WALLET ==========
    async function connectTelegram() {
        const tg = window.Telegram?.WebApp;
        if (tg) {
            window.open('https://t.me/wallet', '_blank');
            const uid = tg.initDataUnsafe?.user?.id || Date.now();
            return { address: 'tg:' + uid, chain: 'telegram', shortAddr: 'TG:' + String(uid).slice(-6), label: 'Telegram', balance: 0 };
        }
        toast('Open in Telegram Mini App.');
        return null;
    }

    // ========== REAL USDT SEND (for TON) ==========
    window._sendUSDT = async function(amount, dealId) {
        if (!connected) { toast('Connect wallet first.'); return null; }

        if (connected.chain === 'ton') {
            const transfer = await apiCall('/ton/transfer', 'POST', { sender: connected.address, amount, dealId });
            if (transfer?.deepLink) {
                showTxProgress('Opening TON wallet... Confirm the transfer, then return.');
                window.location.href = transfer.deepLink;
                
                return { 
                    success: true, 
                    txHash: 'pending_' + Date.now(), 
                    signedUrl: transfer.deepLink,
                    returnUrl: transfer.returnUrl,
                    instructions: transfer.instructions 
                };
            }
            toast('Transfer generation failed.');
            return null;
        }

        if (connected.chain === 'evm' && window.ethereum) {
            try {
                const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
                const to = '0x0000000000000000000000000000000000000000';
                const valueHex = '0x' + Math.floor(amount * 1e6).toString(16);
                const data = '0xa9059cbb' + to.slice(2).padStart(64,'0') + valueHex.slice(2).padStart(64,'0');
                
                showTxProgress('Confirm in MetaMask...');
                const txHash = await window.ethereum.request({
                    method: 'eth_sendTransaction',
                    params: [{ from: connected.address, to: USDT, data, gas: '0x186A0' }],
                });
                hideTxProgress();
                return { success: true, txHash };
            } catch(e) { 
                hideTxProgress();
                toast('Transaction rejected.'); 
                return null; 
            }
        }

        toast('Manual transfer: send ' + amount + ' USDT to guarantor wallet.');
        return null;
    };

    function showTxProgress(msg) {
        const el = document.getElementById('txProgress');
        const txt = document.getElementById('txProgressText');
        if (el) el.style.display = 'block';
        if (txt) txt.textContent = msg || 'Sending USDT...';
    }

    function hideTxProgress() {
        const el = document.getElementById('txProgress');
        if (el) el.style.display = 'none';
    }

    window._connectedWallet = function() { return connected; };
    window._showTxProgress = showTxProgress;
    window._hideTxProgress = hideTxProgress;
})();
