// Escrow Smart Contract — Full Deployment Pipeline
// ==================================================
// Prerequisites: Node.js 18+, @ton/ton, @ton/crypto
// Install: npm install @ton/ton @ton/crypto @ton/blueprint
//
// Compile: npx func-js contract/escrow.fc --boc escrow.cell
// Deploy:  npx blueprint run

const fs = require("fs");
const path = require("path");

const CONTRACT_PATH = path.join(__dirname, "escrow.fc");
const COMPILED_PATH = path.join(__dirname, "escrow.cell");

// Configuration
const CONFIG = {
    network: process.env.TON_NETWORK || "testnet",  // testnet | mainnet
    guarantorWallet: "UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp",
    endpoints: {
        testnet: "https://testnet.toncenter.com/api/v2/jsonRPC",
        mainnet: "https://toncenter.com/api/v2/jsonRPC",
    },
};

async function compile() {
    console.log("Compiling escrow.fc...");
    console.log("Run: npx func-js " + CONTRACT_PATH + " --boc " + COMPILED_PATH);
    console.log("Then deploy using Blueprint or toncli");
}

async function deploy(sellerWallet, buyerWallet, dealId) {
    console.log("Deploying escrow contract for deal:", dealId);
    console.log("  Network:", CONFIG.network);
    console.log("  Seller:", sellerWallet);
    console.log("  Buyer:", buyerWallet);
    console.log("  Guarantor:", CONFIG.guarantorWallet);

    const initData = {
        seller: sellerWallet,
        buyer: buyerWallet,
        guarantor: CONFIG.guarantorWallet,
        dealId: dealId,
    };

    console.log("  Init data:", JSON.stringify(initData, null, 2));
    console.log("");
    console.log("To deploy on mainnet:");
    console.log("  1. Set TON_NETWORK=mainnet");
    console.log("  2. Ensure wallet has > 0.05 TON for fees");
    console.log("  3. Run: npx blueprint run contract/deploy.js");
}

// CLI
if (require.main === module) {
    const args = process.argv.slice(2);
    const cmd = args[0] || "compile";

    if (cmd === "compile") {
        compile();
    } else if (cmd === "deploy") {
        const seller = args[1] || "UQ...";
        const buyer = args[2] || "UQ...";
        const dealId = args[3] || "test-deal-001";
        deploy(seller, buyer, dealId);
    } else {
        console.log("Usage: node deploy.js [compile|deploy] [seller] [buyer] [dealId]");
    }
}

module.exports = { compile, deploy, CONFIG };
