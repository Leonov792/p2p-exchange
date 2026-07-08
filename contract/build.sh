#!/bin/bash
# Build and deploy P2P Escrow smart contract to TON testnet
# Requires: func, fift, lite-client

echo "=== Building escrow contract ==="
func -o escrow_code.fif -P stdlib.fc ../contract/escrow.fc 2>&1

echo "=== Compiling to BOC ==="
fift -s fift/compile.fif escrow_code 2>&1

echo "=== Contract compiled ==="
echo "escrow_code.boc ready for deployment"
echo ""
echo "Deploy command:"
echo "fift -s fift/deploy.fif escrow_code.boc <seller_addr> <buyer_addr> <guarantor_addr>"
echo ""
echo "Guarantor (P2P Exchange): UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp"
echo ""
echo "After deploy, set ESCROW_CONTRACT_ADDRESS in Vercel environment variables"
