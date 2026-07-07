// Smart Contract Deploy Pipeline — TON Mainnet
// ==================================================
// Prerequisites: Node.js, @ton/ton, @ton/crypto, func compiler
// Install: npm i -g @ton/ton @ton/crypto @ton/blueprint

const CONTRACT_PATH = "contract/escrow.fc";
const MAINNET_ENDPOINT = "https://toncenter.com/api/v2/jsonRPC";
const GUARANTOR = "UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp";

async function compile() {
  console.log("Compiling escrow.fc to BOC...");
  console.log("func -SPA -o escrow.cell " + CONTRACT_PATH);
  console.log("If func not installed: npm i -g @ton-community/func-js");
}

async function deployMainnet(sellerWallet, buyerWallet, dealId) {
  console.log("\n=== TON MAINNET DEPLOY ===");
  console.log("Network: mainnet");
  console.log("Guarantor:", GUARANTOR);
  console.log("Seller:", sellerWallet);
  console.log("Buyer:", buyerWallet);
  console.log("Deal ID:", dealId);
  console.log("\nSteps:");
  console.log("1. Ensure wallet has > 0.05 TON for fees");
  console.log("2. Run: npx blueprint run");
  console.log("3. Contract address will be logged");
  console.log("4. Monitor on: https://tonscan.org/");
  console.log("\nDeploy cost: ~0.05 TON ($0.30)");
  console.log("Contract methods:");
  console.log("  lock(seller, buyer, amount)   — freeze USDT");
  console.log("  release()                     — send to buyer (guarantor only)");
  console.log("  refund()                      — return to seller (guarantor or timeout)");
  console.log("  get_wallet_data()              — view escrow state");
}

async function deployTestnet(sellerWallet, buyerWallet, dealId) {
  console.log("\n=== TON TESTNET DEPLOY (FREE) ===");
  console.log("Network: testnet");
  console.log("Use testnet.toncenter.com for verification");
  console.log("Get test TON from: https://t.me/testgiver_ton_bot");
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0] || "compile";
  if (cmd === "compile") compile();
  else if (cmd === "mainnet") deployMainnet(args[1] || "UQ...", args[2] || "UQ...", args[3] || "deal-001");
  else if (cmd === "testnet") deployTestnet(args[1] || "UQ...", args[2] || "UQ...", args[3] || "deal-001");
  else console.log("Usage: node deploy.js [compile|mainnet|testnet] [seller] [buyer] [dealId]");
}

module.exports = { compile, deployMainnet, deployTestnet };
