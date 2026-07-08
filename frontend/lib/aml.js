const { pool } = require("./db");

const HIGH_RISK_WALLETS = new Set();

async function checkAMLScore(walletAddress, amountUsdt) {
  let riskScore = 0;
  const flags = [];

  const { rows: knownChecks } = await pool.query(
    "SELECT risk_score, flags FROM aml_checks WHERE wallet_address = $1 ORDER BY created_at DESC LIMIT 1",
    [walletAddress]
  );
  if (knownChecks.length > 0 && knownChecks[0].risk_score >= 60) {
    return { riskScore: knownChecks[0].risk_score, flags: knownChecks[0].flags || [], allowed: false, cached: true };
  }

  try {
    const res = await fetch("https://toncenter.com/api/v2/getAddressInformation?address=" + walletAddress);
    const data = await res.json();
    if (!data.ok || !data.result) {
      riskScore += 10;
      flags.push("wallet_not_found");
    } else {
      const balance = parseInt(data.result.balance || "0") / 1e9;
      if (balance < 0.01) { riskScore += 5; flags.push("empty_wallet"); }
      if (balance > 1000000) { riskScore += 5; flags.push("high_balance"); }
    }
  } catch {
    riskScore += 10;
    flags.push("wallet_verification_failed");
  }

  const txs = await fetch("https://toncenter.com/api/v2/getTransactions?address=" + walletAddress + "&limit=10&archival=true").then(r => r.json()).catch(() => ({ ok: false }));
  if (txs.ok && txs.result) {
    const txCount = txs.result.length;
    if (txCount === 0) { riskScore += 20; flags.push("no_transactions"); }
    if (txCount === 1) { riskScore += 15; flags.push("single_transaction"); }

    const recentTx = txs.result.filter(t => {
      const time = parseInt(t.utime || "0") * 1000;
      return Date.now() - time < 3600000;
    });
    if (recentTx.length > 20) { riskScore += 10; flags.push("high_frequency"); }
  }

  if (HIGH_RISK_WALLETS.has(walletAddress)) { riskScore += 90; flags.push("blacklisted"); }

  if (amountUsdt > 10000 && riskScore > 20) { riskScore += 15; flags.push("large_amount_new_wallet"); }

  riskScore = Math.min(100, riskScore);

  await pool.query(
    "INSERT INTO aml_checks (wallet_address, amount_usdt, risk_score, flags) VALUES ($1, $2, $3, $4)",
    [walletAddress, amountUsdt, riskScore, JSON.stringify(flags)]
  );

  if (riskScore >= 60) { HIGH_RISK_WALLETS.add(walletAddress); }

  return {
    riskScore,
    flags,
    allowed: riskScore < 60,
    requiresManualReview: riskScore >= 30 && riskScore < 60,
    blocked: riskScore >= 60,
  };
}

async function blacklistWallet(walletAddress, reason) {
  HIGH_RISK_WALLETS.add(walletAddress);
  await pool.query(
    "INSERT INTO aml_checks (wallet_address, amount_usdt, risk_score, flags) VALUES ($1, 0, 100, $2)",
    [walletAddress, JSON.stringify(["manual_blacklist", reason])]
  );
  return { blacklisted: true, address: walletAddress, reason };
}

module.exports = { checkAMLScore, blacklistWallet, HIGH_RISK_WALLETS };
