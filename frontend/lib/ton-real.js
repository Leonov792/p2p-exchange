const crypto = require("crypto");

const GUARANTOR = "UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp";
const USDT_MASTER = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const TON_API = "https://toncenter.com/api/v2";
const COMMISSION_PCT = 0.02;
const COMMISSION_WALLET = GUARANTOR;

async function fetchTON(path) {
  return fetch(TON_API + path).then(r => r.json()).catch(() => null);
}

async function getBalance(address) {
  const res = await fetchTON("/getAddressInformation?address=" + address);
  if (res?.ok && res.result) {
    return parseInt(res.result.balance || "0") / 1e9;
  }
  return 0;
}

async function getTransactions(address, limit = 20) {
  const res = await fetchTON("/getTransactions?address=" + address + "&limit=" + limit + "&archival=true");
  if (res?.ok && res.result) return res.result;
  return [];
}

function buildUSDTTransferPayload(amount, recipient, comment) {
  const amountNano = BigInt(Math.floor(amount * 1e6)).toString();
  const queryId = BigInt(Date.now()).toString();
  const recipientAddr = recipient || GUARANTOR;

  try {
    const body = Buffer.alloc(4 + 8 + 8 + 32 + 1 + 1 + 4 + 1);
    body.writeUInt32BE(0x0f8a7ea5, 0);
    body.writeBigUInt64BE(BigInt(queryId), 4);
    body.writeBigUInt64BE(BigInt(amountNano), 12);
    body.write(recipientAddr, 20, 32, "hex");
    return body.toString("hex");
  } catch {
    return null;
  }
}

async function createTransferPayload(fromWallet, amount, dealId) {
  const safeAmount = Math.max(0.01, amount);
  const tonAmount = (safeAmount * 0.05).toFixed(4);

  const comment = "P2P_DEAL_" + (dealId || Date.now());

  const payload = buildUSDTTransferPayload(safeAmount, GUARANTOR, comment);

  return {
    recipient: GUARANTOR,
    amount: String(Math.floor(parseFloat(tonAmount) * 1e9)),
    comment: comment,
    jettonTransfer: {
      jettonAddress: USDT_MASTER,
      amount: safeAmount,
      destination: GUARANTOR,
      forwardAmount: "1",
    },
    payload: payload,
    signedUrl: "ton://transfer/" + GUARANTOR + "?amount=" + tonAmount + "&text=" + encodeURIComponent(comment),
  };
}

async function verifyIncomingPayment(senderAddress, expectedAmount, dealId) {
  const txs = await getTransactions(GUARANTOR, 50);
  const comment = "P2P_DEAL_" + dealId;

  for (const tx of txs) {
    if (!tx.in_msg || !tx.in_msg.source) continue;
    const value = parseInt(tx.in_msg.value || "0") / 1e9;
    const msgComment = tx.in_msg.message || "";
    const matchesSender = !senderAddress || tx.in_msg.source === senderAddress;
    const matchesDeal = msgComment.includes(comment) || msgComment.includes(dealId?.slice(0, 8));
    if (matchesSender && value >= expectedAmount * 0.95) {
      return {
        confirmed: true,
        txHash: tx.transaction_id?.hash || "",
        amount: value,
        sender: tx.in_msg.source,
        time: parseInt(tx.utime || "0") * 1000,
      };
    }
  }
  return { confirmed: false };
}

function calculateCommission(amount) {
  const fee = amount * COMMISSION_PCT;
  return {
    amount: amount,
    fee: parseFloat(fee.toFixed(6)),
    sellerGets: parseFloat((amount - fee).toFixed(6)),
    platform: COMMISSION_WALLET,
    percent: COMMISSION_PCT * 100,
  };
}

async function getExchangeRateTON() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,tether&vs_currencies=usd,rub");
    const d = await r.json();
    return {
      tonUsd: d["the-open-network"]?.usd || 5.5,
      usdtRub: d["tether"]?.rub || 92.5,
      tonRub: (d["the-open-network"]?.rub || 500),
      updated: Date.now(),
    };
  } catch {
    return { tonUsd: 5.5, usdtRub: 92.5, tonRub: 500, updated: Date.now() };
  }
}

module.exports = {
  GUARANTOR, USDT_MASTER, COMMISSION_WALLET, COMMISSION_PCT,
  getBalance, getTransactions, createTransferPayload,
  verifyIncomingPayment, calculateCommission, getExchangeRateTON,
  buildUSDTTransferPayload,
};
