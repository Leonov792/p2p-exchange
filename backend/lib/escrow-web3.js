const { deployEscrowContract } = require("./ton-tx");
const { pool } = require("./db");
const { broadcast } = require("./ws");

const ESCROW_STATES = {
  AWAITING_DEPOSIT: "awaiting_deposit",
  FUNDED: "funded",
  RELEASED_TO_BUYER: "released_to_buyer",
  REFUNDED_TO_SELLER: "refunded_to_seller",
  TIMED_OUT: "timed_out",
};

async function createWeb3Escrow(dealId, sellerAddress, buyerAddress, amountUsdt) {
  const contract = await deployEscrowContract(sellerAddress, buyerAddress, dealId);

  await pool.query(
    `INSERT INTO web3_escrows (deal_id, seller_address, buyer_address, amount_usdt, contract_address, network, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (deal_id) DO UPDATE SET status = 'awaiting_deposit'`,
    [dealId, sellerAddress, buyerAddress, amountUsdt, contract.contractAddress, contract.network, ESCROW_STATES.AWAITING_DEPOSIT]
  );

  broadcast("escrow_created", { dealId, sellerAddress, buyerAddress, amountUsdt, contract: contract.contractAddress });

  return {
    dealId,
    contractAddress: contract.contractAddress,
    sellerAddress,
    buyerAddress,
    amountUsdt,
    status: ESCROW_STATES.AWAITING_DEPOSIT,
    deployInstructions: contract.boc === "compiled" ? null : contract.boc,
  };
}

async function releaseWeb3Escrow(dealId, adminId, toBuyer) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const escrow = (await client.query(
      "SELECT * FROM web3_escrows WHERE deal_id = $1 FOR UPDATE", [dealId]
    )).rows[0];

    if (!escrow) throw Object.assign(new Error("Escrow not found"), { statusCode: 404 });
    if (escrow.status !== ESCROW_STATES.FUNDED) {
      throw Object.assign(new Error("Escrow not funded"), { statusCode: 409 });
    }

    const newStatus = toBuyer ? ESCROW_STATES.RELEASED_TO_BUYER : ESCROW_STATES.REFUNDED_TO_SELLER;
    await client.query("UPDATE web3_escrows SET status = $1, resolved_by = $2, resolved_at = NOW() WHERE deal_id = $3",
      [newStatus, adminId, dealId]);

    const oracleSignature = {
      dealId,
      action: toBuyer ? "release_to_buyer" : "refund_to_seller",
      recipient: toBuyer ? escrow.buyer_address : escrow.seller_address,
      timestamp: Date.now(),
      signedBy: adminId,
    };

    await client.query("COMMIT");
    broadcast("escrow_released", { dealId, oracleSignature, status: newStatus });
    return { released: true, oracleSignature, status: newStatus };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function checkEscrowStatus(dealId) {
  const escrow = (await pool.query(
    "SELECT * FROM web3_escrows WHERE deal_id = $1", [dealId]
  )).rows[0];

  if (!escrow) return { status: "not_found" };

  return {
    dealId,
    status: escrow.status,
    contractAddress: escrow.contractAddress,
    seller: escrow.seller_address,
    buyer: escrow.buyer_address,
    amount: escrow.amount_usdt,
    created: escrow.created_at,
  };
}

module.exports = { createWeb3Escrow, releaseWeb3Escrow, checkEscrowStatus, ESCROW_STATES };
