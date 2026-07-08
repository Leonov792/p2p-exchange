// TON blockchain integration
// Guarantor wallet address
const GUARANTOR_WALLET = "UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp";

// TON Center API for transaction verification
const TON_API = "https://toncenter.com/api/v2";

async function getWalletInfo(address) {
  try {
    const res = await fetch(`${TON_API}/getAddressInformation?address=${address}`);
    const json = await res.json();
    return json.ok ? json.result : null;
  } catch (e) {
    console.error("TON getWalletInfo error:", e.message);
    return null;
  }
}

async function getTransactions(address, limit = 20) {
  try {
    const res = await fetch(`${TON_API}/getTransactions?address=${address}&limit=${limit}&archival=true`);
    const json = await res.json();
    return json.ok ? json.result : [];
  } catch (e) {
    console.error("TON getTransactions error:", e.message);
    return [];
  }
}

// Check if a specific USDT transfer was received by the guarantor
async function verifyDeposit(txHash, expectedAmount, senderAddress) {
  try {
    const res = await fetch(`${TON_API}/getTransactions?address=${GUARANTOR_WALLET}&limit=50&archival=true`);
    const json = await res.json();
    if (!json.ok || !json.result) return false;

    const tx = json.result.find((t) => {
      if (txHash && t.transaction_id?.hash === txHash) return true;
      if (senderAddress && t.in_msg?.source === senderAddress) {
        const value = parseInt(t.in_msg?.value || "0") / 1e9;
        return value >= expectedAmount * 0.99;
      }
      return false;
    });

    return tx ? { confirmed: true, txHash: tx.transaction_id?.hash, amount: parseInt(tx.in_msg?.value || "0") / 1e9 } : false;
  } catch (e) {
    console.error("TON verifyDeposit error:", e.message);
    return false;
  }
}

// Calculate equivalent USDT amount for RUB (rate from TON/USDT markets)
function rubToUsdt(amountRub) {
  const rate = 92.5;
  return (amountRub / rate).toFixed(6);
}

function usdtToRub(amountUsdt) {
  const rate = 92.5;
  return (amountUsdt * rate).toFixed(2);
}

// Generate a payment link for TON transfer
function generatePaymentLink(amountUsdt) {
  const tonAmount = (amountUsdt * 0.18).toFixed(4);
  return `ton://transfer/${GUARANTOR_WALLET}?amount=${tonAmount}&text=P2P-DEAL`;
}

module.exports = {
  GUARANTOR_WALLET,
  getWalletInfo,
  getTransactions,
  verifyDeposit,
  rubToUsdt,
  usdtToRub,
  generatePaymentLink,
};
