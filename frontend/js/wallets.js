// Wallet Connect — TON Connect SDK + WalletConnect v2 + Session Persistence
// ========================================================================
(function() {
    const API = 'https://p2p-exchange-api.vercel.app/api';
    const MANIFEST = 'https://p2p-exchange-sigma.vercel.app/tonconnect-manifest.json';
    const WC_PROJECT_ID = 'c1f1c1f1c1f1c1f1c1f1c1f1c1f1c1f1';

    let connected = null;
    let tonConnectUI = null;
    let wcProvider = null;

    function toast(msg) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg; t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3500);
    }

    function setStatus(text) { const el = document.getElementById('connectStatus'); if (el) el.textContent = text; }

    function updateUI(shortAddr, balance) {
        const btn = document.getElementById('btnConnectWallet');
        const bal = document.getElementById('balanceDisplay');
        if (btn) btn.textContent = shortAddr;
        if (bal && balance !== undefined) bal.textContent = Number(balance).toFixed(2) + ' USDT';
    }

    function saveSession() {
        if (!connected) return;
        localStorage.setItem('p2p_wallet', JSON.stringify(connected));
    }

    function loadSession() {
        try {
            const raw = localStorage.getItem('p2p_wallet');
            if (raw) { connected = JSON.parse(raw); return connected; }
        } catch {}
        return null;
    }

    function clearSession() {
        localStorage.removeItem('p2p_wallet');
        connected = null;
    }

    // ========== TON CONNECT SDK ==========
    async function initTonConnectSDK() {
        if (tonConnectUI) return tonConnectUI;
        if (typeof window.TonConnectUI === 'undefined') return null;

        try {
            tonConnectUI = new window.TonConnectUI({ manifestUrl: MANIFEST });

            tonConnectUI.onStatusChange(function(wallet) {
                if (!wallet) return;
                const addr = wallet.account?.address || '';
                connected = {
                    address: addr,
                    chain: 'ton',
                    shortAddr: addr.slice(0, 8) + '...' + addr.slice(-4),
                    label: wallet.device?.appName || 'TON Wallet',
                    balance: 0,
                };
                saveSession();
                updateUI(connected.shortAddr, 0);
                document.getElementById('btnConnectWallet')?.classList.add('connected');
                document.getElementById('connectModal')?.classList.remove('active');
                toast('TON connected: ' + connected.shortAddr);
                syncBalance(addr, 'ton');
            });

            return tonConnectUI;
        } catch (e) {
            console.error('TON Connect init:', e);
            return null;
        }
    }

    async function connectTONviaSDK() {
        const sdk = await initTonConnectSDK();
        if (!sdk) {
            toast('TON Connect loading. Try again in 3 seconds.');
            return null;
        }
        setStatus('Opening TON wallet list...');
        await sdk.connectWallet();
        return null;
    }

    async function openSpecificTONWallet(wallet) {
        const sdk = await initTonConnectSDK();
        if (!sdk) return null;

        const walletMap = {
            tonkeeper: 'Tonkeeper',
            tonhub: 'Tonhub',
            mytonwallet: 'MyTonWallet',
        };

        setStatus('Opening ' + (walletMap[wallet] || wallet) + '...');

        try {
            await sdk.connectWallet();
            return null;
        } catch {
            const dappUrl = encodeURIComponent('https://p2p-exchange-sigma.vercel.app');
            const urls = {
                tonkeeper: 'https://app.tonkeeper.com/ton-login?url=' + dappUrl,
                tonhub: 'https://tonhub.com/ton-connect/?url=' + dappUrl,
                mytonwallet: 'https://mytonwallet.app/ton-connect?url=' + dappUrl,
            };
            window.open(urls[wallet], '_blank');
            setStatus('Return to this page after connecting...');
            return null;
        }
    }

    // ========== WALLETCONNECT v2 (MetaMask, Trust Wallet, Phantom EVM) ==========
    async function initWalletConnect() {
        if (wcProvider) return wcProvider;

        if (typeof window.WalletConnectModal === 'undefined') {
            console.log('WalletConnect not loaded, using fallback');
            return null;
        }

        try {
            const { WalletConnectModal } = window;
            wcProvider = new WalletConnectModal({
                projectId: WC_PROJECT_ID,
                chains: [1, 56, 137],
                optionalChains: [],
                mobileWallets: [
                    { id: 'metamask', name: 'MetaMask', links: { native: 'metamask://', universal: 'https://metamask.app.link' } },
                    { id: 'trust', name: 'Trust Wallet', links: { native: 'trust://', universal: 'https://link.trustwallet.com' } },
                    { id: 'phantom', name: 'Phantom', links: { native: 'phantom://', universal: 'https://phantom.app/ul' } },
                ],
            });

            wcProvider.subscribeModal(function(state) {
                if (state.open) return;
                if (!state.address) return;

                connected = {
                    address: state.address,
                    chain: 'evm',
                    shortAddr: state.address.slice(0, 6) + '...' + state.address.slice(-4),
                    label: state.selectedWallet || 'EVM Wallet',
                    balance: 0,
                };
                saveSession();
                updateUI(connected.shortAddr, 0);
                document.getElementById('btnConnectWallet')?.classList.add('connected');
                document.getElementById('connectModal')?.classList.remove('active');
                toast('EVM connected: ' + connected.shortAddr);
                syncBalance(state.address, 'evm');
            });

            return wcProvider;
        } catch (e) {
            console.error('WalletConnect init:', e);
            return null;
        }
    }

    async function connectEVMviaWC() {
        const wc = await initWalletConnect();
        if (wc) {
            setStatus('Opening wallet selector...');
            await wc.openModal();
            return null;
        }
        return await connectEVMFallback();
    }

    async function connectEVMFallback() {
        setStatus('Opening wallet via deep-link...');
        window.open('https://metamask.app.link/dapp/p2p-exchange-sigma.vercel.app', '_blank');
        const addr = prompt('Paste your wallet address (0x...):', '');
        if (!addr || !addr.startsWith('0x')) return null;
        await syncBalance(addr, 'evm');
        return { address: addr, chain: 'evm', shortAddr: addr.slice(0,6)+'...'+addr.slice(-4), label: 'EVM Wallet', balance: 0 };
    }

    // ========== TELEGRAM WALLET ==========
    async function connectTelegramWallet() {
        const tg = window.Telegram?.WebApp;
        if (tg) {
            window.open('https://t.me/wallet', '_blank');
            const uid = tg.initDataUnsafe?.user?.id || Date.now();
            return { address: 'tg:' + uid, chain: 'telegram', shortAddr: 'TG:' + String(uid).slice(-6), label: 'Telegram', balance: 0 };
        }
        window.open('https://t.me/wallet', '_blank');
        return null;
    }

    // ========== BALANCE SYNC ==========
    async function syncBalance(address, chain) {
        try {
            const uid = localStorage.getItem('p2p_user_id') || '0';
            const r = await fetch(API + '/wallet/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Telegram-User-ID': uid },
                body: JSON.stringify({ address, chain, balance: 0 }),
            });
            const d = await r.json();
            if (d?.balance !== undefined) updateUI(connected?.shortAddr || 'Connected', d.balance);
        } catch {}
    }

    // ========== SESSION PERSISTENCE ==========
    function autoReconnect() {
        const saved = loadSession();
        if (!saved) return;

        const btn = document.getElementById('btnConnectWallet');
        if (btn) {
            btn.textContent = saved.shortAddr;
            btn.classList.add('connected');
        }
        if (saved.address) syncBalance(saved.address, saved.chain);
        toast('Reconnected: ' + saved.shortAddr);
    }

    // ========== SEND USDT ==========
    window._sendUSDT = async function(amount, dealId) {
        if (!connected) { toast('Connect wallet first.'); return null; }

        if (connected.chain === 'ton' && tonConnectUI) {
            try {
                const transfer = await fetch(API + '/ton/transfer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sender: connected.address, amount, dealId }),
                }).then(r => r.json());

                if (transfer?.deepLink) {
                    window.location.href = transfer.deepLink;
                    return { success: true, txHash: 'pending_' + Date.now(), signedUrl: transfer.deepLink };
                }
            } catch(e) { console.error('TON send:', e); }
        }

        if (connected.chain === 'evm' && wcProvider) {
            toast('EVM transfers via WalletConnect. Confirm in wallet.');
        }

        toast('Send ' + amount + ' USDT to guarantor.');
        return null;
    };

    window._connectedWallet = function() { return connected; };

    // ========== INIT ==========
    document.addEventListener('DOMContentLoaded', function() {
        const modal = document.getElementById('connectModal');
        const btn = document.getElementById('btnConnectWallet');
        const cancel = document.getElementById('btnCancelConnect');
        if (!modal || !btn) return;

        initTonConnectSDK();
        autoReconnect();

        btn.onclick = function() {
            if (connected) { clearSession(); btn.textContent = 'Connect Wallet'; btn.classList.remove('connected'); updateUI('0.00 USDT', 0); return; }
            modal.classList.add('active');
        };

        cancel.onclick = function() { modal.classList.remove('active'); };
        modal.addEventListener('click', function(e) { if (e.target === modal) modal.classList.remove('active'); });

        document.getElementById('walletGrid').addEventListener('click', async function(e) {
            const item = e.target.closest('.wallet-item');
            if (!item) return;
            const wallet = item.dataset.wallet;
            item.classList.add('connecting');

            let result = null;
            try {
                if (wallet === 'tonkeeper' || wallet === 'tonhub' || wallet === 'mytonwallet') {
                    result = await openSpecificTONWallet(wallet);
                } else if (wallet === 'metamask' || wallet === 'trustwallet' || wallet === 'phantom') {
                    result = await connectEVMviaWC();
                } else if (wallet === 'telegram') {
                    result = await connectTelegramWallet();
                }
            } catch(e) { console.error(wallet, e); }

            item.classList.remove('connecting');
            if (result) {
                connected = result; saveSession();
                item.classList.add('connected');
                updateUI(result.shortAddr, result.balance || 0);
                btn.classList.add('connected');
                modal.classList.remove('active');
                toast('Connected: ' + (result.label || wallet));
            } else {
                setStatus('');
            }
        });
    });
})();
