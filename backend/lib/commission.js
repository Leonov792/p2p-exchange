// Commission System — auto-deduct platform fee per deal
// ========================================================

const DEFAULT_FEE_PERCENT = 2.0;
const PLATFORM_WALLET = "UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp";

function calculateFee(amountUsdt, feePercent = DEFAULT_FEE_PERCENT) {
  const fee = (amountUsdt * feePercent) / 100;
  return {
    total: amountUsdt,
    fee: parseFloat(fee.toFixed(6)),
    sellerReceived: parseFloat((amountUsdt - fee).toFixed(6)),
    feePercent,
    platformWallet: PLATFORM_WALLET,
  };
}

function calculateVolumeDiscount(totalVolume30d) {
  if (totalVolume30d >= 1000000) return 0.5;
  if (totalVolume30d >= 500000) return 1.0;
  if (totalVolume30d >= 100000) return 1.5;
  return DEFAULT_FEE_PERCENT;
}

async function processCommission(client, dealId, amountUsdt) {
  const fee = calculateFee(amountUsdt);

  await client.query("INSERT INTO commissions (deal_id, amount_usdt, fee_usdt, fee_percent, platform_wallet) VALUES ($1,$2,$3,$4,$5)",
    [dealId, amountUsdt, fee.fee, fee.feePercent, PLATFORM_WALLET]);

  return fee;
}

module.exports = { calculateFee, calculateVolumeDiscount, processCommission, DEFAULT_FEE_PERCENT, PLATFORM_WALLET };
