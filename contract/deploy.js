// Escrow Smart Contract Deployment Script
// Requires: @ton/ton, @ton/crypto
// Run: npx tsx contract/deploy.ts

const TON_GUARANTOR = "UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp";

async function deployEscrow(sellerAddr, buyerAddr, dealId) {
    // Compile using func compiler
    // func -o escrow.cell -SPA contract/escrow.fc
    
    // Deploy contract
    // const contract = await tonClient.open(Contract.createFromConfig({
    //     seller: Address.parse(sellerAddr),
    //     buyer: Address.parse(buyerAddr),
    //     guarantor: Address.parse(TON_GUARANTOR),
    //     deal_id: dealId,
    // }, EscrowContractSource));
    
    console.log("Deploy escrow for deal:", dealId);
    console.log("Seller:", sellerAddr);
    console.log("Buyer:", buyerAddr);
    console.log("Guarantor:", TON_GUARANTOR);
}

// For production: compile with `func` compiler and deploy via toncli
// func -SPA -o escrow.cell contract/escrow.fc
// toncli deploy escrow.cell

module.exports = { deployEscrow };
