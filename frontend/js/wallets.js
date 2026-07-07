// Wallet Connect — All 7 Wallets
// ============================================
let connectedChain = null;
let connectedAddress = null;

const API = 'https://p2p-exchange-api.vercel.app/api';
const GUARANTOR = "UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp";

function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

function setStatus(text) {
    document.getElementById('connectStatus').textContent = text;
}

async function apiCall(path, method = 'GET', body = null) {
    const h = { 'Content-Type': 'application/json' };
    if (window._currentUser) h['X-Telegram-User-ID'] = String(window._currentUser.id);
    try {
        const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : null });
        return r.ok ? r.json() : null;
    } catch { return null; }
}

// ========== TON WALLETS (Tonkeeper, Tonhub, MyTonWallet) ==========
let tonConnectInstance = null;

async function connectTONWallet() {
    if (typeof window.TonConnectUI === 'undefined') {
        setStatus('TON Connect SDK loading...');
        await new Promise(r => setTimeout(r, 2000));
        if (typeof window.TonConnectUI === 'undefined') {
            toast('Open in Telegram for TON wallets');
            return null;
        }
    }

    try {
        tonConnectInstance = new window.TonConnectUI({
            manifestUrl: 'https://p2p-exchange-sigma.vercel.app/tonconnect-manifest.json',
        });

        setStatus('Opening TON wallet...');
        await tonConnectInstance.connectWallet();

        const w = tonConnectInstance.wallet;
        if (!w?.account?.address) { setStatus('Connection failed'); return null; }

        const addr = w.account.address;
        connectedChain = 'ton';
        connectedAddress = addr;
        return { chain: 'ton', address: addr, device: w.device?.appName || 'TON Wallet' };
    } catch (e) {
        setStatus('User cancelled');
        console.error('TON connect:', e);
        return null;
    }
}

async function connectTONDeepLink(appName) {
    const dappUrl = encodeURIComponent('https://p2p-exchange-sigma.vercel.app');
    let url = '';
    if (appName === 'tonkeeper') url = 'https://app.tonkeeper.com/ton-connect?v=2&url=' + dappUrl;
    else if (appName === 'tonhub') url = 'https://tonhub.com/ton-connect?v=2&url=' + dappUrl;
    else if (appName === 'mytonwallet') url = 'https://mytonwallet.app/ton-connect?v=2&url=' + dappUrl;
    else url = 'https://go.tonkeeper.com/ton-login?url=' + dappUrl;

    setStatus('Opening ' + appName + '...');
    window.open(url, '_blank');

    setTimeout(async () => {
        setStatus('Waiting for connection...');
        const result = await connectTONWallet();
        if (result) {
            toast('Connected: ' + result.device);
            setStatus('Connected!');
        }
    }, 3000);
    return null;
}

// ========== EVM WALLETS (MetaMask, Trust Wallet, Phantom) ==========
async function connectEVMWallet(walletName) {
    let provider = null;

    if (walletName === 'phantom') {
        if (window.solana && window.solana.isPhantom) {
            return await connectPhantomSolana();
        }
    }

    if (window.ethereum) {
        provider = window.ethereum;
    } else if (window.trustwallet) {
        provider = window.trustwallet;
    }

    if (!provider) {
        if (walletName === 'metamask') {
            window.open('https://metamask.app.link/dapp/p2p-exchange-sigma.vercel.app', '_blank');
            toast('Opening MetaMask. Install if needed.');
        } else if (walletName === 'trustwallet') {
            window.open('https://link.trustwallet.com/open_url?url=https://p2p-exchange-sigma.vercel.app', '_blank');
            toast('Opening Trust Wallet.');
        } else if (walletName === 'phantom') {
            window.open('https://phantom.app/ul/browse/https://p2p-exchange-sigma.vercel.app', '_blank');
            toast('Opening Phantom browser.');
        }
        setStatus('Opened ' + walletName);
        return null;
    }

    try {
        setStatus('Requesting accounts...');
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        if (!accounts || !accounts.length) { setStatus('No accounts'); return null; }

        const addr = accounts[0];
        connectedChain = 'evm';
        connectedAddress = addr;

        // Get USDT balance
        const USDT_ADDR = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
        const data = '0x70a08231000000000000000000000000' + addr.slice(2);
        const balanceHex = await provider.request({
            method: 'eth_call',
            params: [{ to: USDT_ADDR, data }, 'latest'],
        }).catch(() => '0x0');
        const balance = parseInt(balanceHex || '0x0', 16) / 1e6;

        await apiCall('/profile', 'PUT', { ton_wallet: addr });
        await apiCall('/wallet/sync', 'POST', { address: addr, chain: 'evm', balance });

        toast('Connected: EVM | ' + balance.toFixed(2) + ' USDT');
        document.getElementById('balanceDisplay').textContent = balance.toFixed(2) + ' USDT';
        document.getElementById('btnConnectWallet').textContent = addr.slice(0, 6) + '...' + addr.slice(-4);
        document.getElementById('btnConnectWallet').classList.add('connected');
        document.getElementById('connectModal').classList.remove('active');

        return { chain: 'evm', address: addr, balance };
    } catch (e) {
        setStatus('User rejected');
        console.error('EVM connect:', e);
        return null;
    }
}

// ========== PHANTOM (Solana) ==========
async function connectPhantomSolana() {
    if (!window.solana || !window.solana.isPhantom) {
        window.open('https://phantom.app/ul/browse/' + encodeURIComponent('https://p2p-exchange-sigma.vercel.app'), '_blank');
        toast('Opening Phantom. Tap the browser icon.');
        setStatus('Waiting for Phantom...');
        return null;
    }

    try {
        setStatus('Connecting Phantom...');
        const resp = await window.solana.connect();
        const addr = resp.publicKey.toString();
        connectedChain = 'solana';
        connectedAddress = addr;

        toast('Connected: Solana | ' + addr.slice(0, 8) + '...');
        return { chain: 'solana', address: addr };
    } catch (e) {
        setStatus('Phantom rejected');
        return null;
    }
}

// ========== TELEGRAM WALLET ==========
async function connectTelegramWallet() {
    const tg = window.Telegram?.WebApp;
    if (!tg) {
        toast('Available only in Telegram Mini App');
        setStatus('Open in Telegram');
        return null;
    }

    if (tg.initDataUnsafe?.user) {
        const uid = tg.initDataUnsafe.user.id;
        connectedChain = 'telegram';
        connectedAddress = 'tg:' + uid;
        const balance = await getTGWalletBalance(uid);
        toast('Telegram Wallet: ' + balance.toFixed(2) + ' USDT');
        return { chain: 'telegram', address: String(uid), balance };
    }

    tg.openLink('https://t.me/wallet');
    setStatus('Opening Telegram Wallet...');
    return null;
}

async function getTGWalletBalance(uid) {
    try {
        const r = await fetch('https://toncenter.com/api/v2/getAddressInformation?address=UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp');
        const d = await r.json();
        return d.ok ? (parseInt(d.result.balance || '0') / 1e9) : 0;
    } catch { return 0; }
}

// ========== CONNECT MODAL ==========
function initConnectModal() {
    const modal = document.getElementById('connectModal');
    const btn = document.getElementById('btnConnectWallet');

    btn.onclick = () => {
        if (connectedAddress) {
            connectedAddress = null;
            connectedChain = null;
            btn.textContent = 'Connect Wallet';
            btn.classList.remove('connected');
            document.getElementById('balanceDisplay').textContent = '0.00 USDT';
            toast('Disconnected');
            return;
        }
        modal.classList.add('active');
        setStatus('');
    };

    document.getElementById('btnCancelConnect').onclick = () => modal.classList.remove('active');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

    document.getElementById('walletGrid').addEventListener('click', async (e) => {
        const item = e.target.closest('.wallet-item');
        if (!item) return;
        const wallet = item.dataset.wallet;
        item.classList.add('connecting');
        setStatus('Connecting to ' + wallet + '...');

        let result = null;
        if (['tonkeeper', 'tonhub', 'mytonwallet'].includes(wallet)) {
            result = await connectTONDeepLink(wallet);
        } else if (['metamask', 'trustwallet', 'phantom'].includes(wallet)) {
            result = await connectEVMWallet(wallet);
        } else if (wallet === 'telegram') {
            result = await connectTelegramWallet();
        }

        item.classList.remove('connecting');

        if (result) {
            item.classList.add('connected');
            window._walletConnected = true;
            window._walletAddress = result.address;
            window._walletChain = result.chain;
            document.getElementById('btnConnectWallet').textContent = result.address.slice(0, 6) + '...' + result.address.slice(-4);
            document.getElementById('btnConnectWallet').classList.add('connected');

            // Sync balance after short delay
            setTimeout(() => syncBalance(result.chain, result.address), 2000);
        } else {
            setStatus('Connection failed or user cancelled');
        }
    });
}

// ========== AUTO BALANCE SYNC ==========
async function syncBalance(chain, address) {
    try {
        const b = await apiCall('/wallet/sync', 'POST', { chain, address });
        if (b?.balance !== undefined) {
            document.getElementById('balanceDisplay').textContent = Number(b.balance).toFixed(2) + ' USDT';
        }
    } catch {}
}

// ========== REAL USDT SEND ==========
async function sendUSDTviaWallet(amount, dealId) {
    if (!connectedAddress || !connectedChain) {
        toast('Connect wallet first');
        return null;
    }

    if (connectedChain === 'ton') {
        const transfer = await apiCall('/ton/transfer', 'POST', { sender: connectedAddress, amount, dealId });
        if (transfer && tonConnectInstance) {
            try {
                setStatus('Confirm in wallet...');
                await tonConnectInstance.sendTransaction({
                    validUntil: Math.floor(Date.now() / 1000) + 300,
                    messages: [{ address: transfer.recipient, amount: transfer.amount }],
                });
                return { success: true, txHash: 'pending_confirm' };
            } catch (e) {
                toast('Transaction rejected');
                return null;
            }
        }
        if (transfer?.signedUrl) { window.open(transfer.signedUrl, '_blank'); }
        return transfer;
    }

    if (connectedChain === 'evm' && window.ethereum) {
        try {
            const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
            const to = GUARANTOR;
            const value = '0x' + Math.floor(amount * 1e6).toString(16);
            const methodId = '0xa9059cbb';
            const toPadded = to.slice(2).padStart(64, '0');
            const valPadded = value.slice(2).padStart(64, '0');
            const data = methodId + toPadded + valPadded;

            const txHash = await window.ethereum.request({
                method: 'eth_sendTransaction',
                params: [{ from: connectedAddress, to: USDT, data, gas: '0x186A0' }],
            });
            return { success: true, txHash };
        } catch (e) {
            toast('EVM transaction rejected');
            return null;
        }
    }

    toast('Manual transfer: send ' + amount + ' USDT to ' + GUARANTOR);
    return null;
}

// Export to window
window._sendUSDT = sendUSDTviaWallet;
window._connectedChain = () => connectedChain;
window._connectedAddress = () => connectedAddress;
