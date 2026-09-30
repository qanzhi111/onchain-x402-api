'use strict';

const { ethers } = require('ethers');
const {
  CHAIN_ID,
  NETWORK_NAME,
  USDC_ADDRESS,
  TRANSFER_SELECTOR
} = require('./config');

/**
 * Parse and structurally validate an x402 v1 "exact" payment payload.
 *
 * The client sends the X-PAYMENT header containing base64-encoded JSON:
 *   { x402Version: 1, scheme: "exact", network: "base",
 *     asset: <USDC contract>, payTo: <recipient>, amount: <atomic units>,
 *     transaction: <signed, not-yet-broadcast EIP-1559 raw tx> }
 *
 * This function performs ONLY structural / cryptographic validation.
 * It never touches the network and never throws on malformed input —
 * instead it returns { ok:false, reason }.
 *
 * @param {string} rawHeader  the raw X-PAYMENT header value
 * @param {object} opts
 * @param {string} opts.payTo        expected recipient address
 * @param {bigint} opts.expectedAtomic minimum acceptable amount (atomic units)
 */
function parsePayment(rawHeader, { payTo, expectedAtomic }) {
  try {
    if (typeof rawHeader !== 'string' || rawHeader.length === 0) {
      return { ok: false, reason: 'missing X-PAYMENT header' };
    }

    // Decode base64 (also tolerate url-safe base64)
    let jsonText;
    try {
      const b64 = rawHeader.trim().replace(/-/g, '+').replace(/_/g, '/');
      jsonText = Buffer.from(b64, 'base64').toString('utf8');
      if (!jsonText || jsonText[0] !== '{') throw new Error('not json');
    } catch (e) {
      return { ok: false, reason: 'X-PAYMENT is not valid base64 JSON' };
    }

    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch (e) {
      return { ok: false, reason: 'X-PAYMENT payload JSON parse failed' };
    }

    if (!payload || typeof payload !== 'object') {
      return { ok: false, reason: 'payload is not an object' };
    }
    if (payload.x402Version !== 1) {
      return { ok: false, reason: `unsupported x402Version: ${payload.x402Version}` };
    }
    if (payload.scheme !== 'exact') {
      return { ok: false, reason: `unsupported scheme: ${payload.scheme}` };
    }
    if (payload.network !== NETWORK_NAME) {
      return { ok: false, reason: `wrong network: ${payload.network} (expected ${NETWORK_NAME})` };
    }
    if (!ethers.isAddress(payload.asset)) {
      return { ok: false, reason: 'asset is not a valid address' };
    }
    if (ethers.getAddress(payload.asset) !== ethers.getAddress(USDC_ADDRESS)) {
      return { ok: false, reason: 'asset is not USDC on Base' };
    }
    if (!ethers.isAddress(payload.payTo)) {
      return { ok: false, reason: 'payTo is not a valid address' };
    }
    if (ethers.getAddress(payload.payTo) !== ethers.getAddress(payTo)) {
      return { ok: false, reason: 'payTo does not match configured recipient' };
    }

    let payloadAmount;
    try {
      payloadAmount = BigInt(payload.amount);
    } catch (e) {
      return { ok: false, reason: 'amount is not an integer (atomic units)' };
    }
    if (payloadAmount < expectedAtomic) {
      return {
        ok: false,
        reason: `amount ${payloadAmount} atomic is below required ${expectedAtomic} atomic`
      };
    }

    if (typeof payload.transaction !== 'string' || !payload.transaction.startsWith('0x')) {
      return { ok: false, reason: 'transaction must be a 0x-prefixed signed raw tx' };
    }

    // Parse the signed transaction (ethers v6 Transaction.from accepts raw hex)
    let tx;
    try {
      tx = ethers.Transaction.from(payload.transaction);
    } catch (e) {
      return { ok: false, reason: `raw transaction parse failed: ${e.message}` };
    }

    if (tx.type === null || tx.type === undefined) {
      return { ok: false, reason: 'transaction type missing (expected EIP-1559 type 2)' };
    }
    if (tx.chainId !== BigInt(CHAIN_ID)) {
      return { ok: false, reason: `wrong chainId: ${tx.chainId} (expected ${CHAIN_ID})` };
    }
    if (!ethers.isAddress(tx.to)) {
      return { ok: false, reason: 'tx.to is not a valid address' };
    }
    if (ethers.getAddress(tx.to) !== ethers.getAddress(USDC_ADDRESS)) {
      return { ok: false, reason: 'tx.to is not the USDC contract' };
    }
    if (tx.value !== 0n) {
      return { ok: false, reason: 'tx.value must be 0 (ERC20 transfer only)' };
    }
    if (tx.nonce === null || tx.nonce === undefined) {
      return { ok: false, reason: 'tx.nonce missing' };
    }

    // Recover sender from signature — proves the tx is properly signed
    let sender;
    try {
      sender = ethers.getAddress(tx.from);
      // ethers v6: Transaction.from already recovers .from from the signature;
      // re-derive it explicitly to fail closed on any signature quirk.
      const recovered = tx.from;
      if (!recovered || !ethers.isAddress(recovered)) throw new Error('no address recovered');
      sender = ethers.getAddress(recovered);
    } catch (e) {
      return { ok: false, reason: `signature recovery failed: ${e.message}` };
    }

    // Validate calldata: transfer(address,uint256)
    const data = tx.data || '0x';
    if (!data.startsWith(TRANSFER_SELECTOR)) {
      return { ok: false, reason: 'calldata selector is not transfer(address,uint256)' };
    }
    let decoded;
    try {
      decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['address', 'uint256'],
        '0x' + data.slice(2 + 8)
      );
    } catch (e) {
      return { ok: false, reason: `transfer calldata decode failed: ${e.message}` };
    }
    const calldataTo = ethers.getAddress(decoded[0]);
    const calldataAmount = BigInt(decoded[1]);
    if (calldataTo !== ethers.getAddress(payTo)) {
      return { ok: false, reason: 'transfer recipient in calldata does not match payTo' };
    }
    if (calldataAmount < expectedAtomic) {
      return {
        ok: false,
        reason: `calldata amount ${calldataAmount} below required ${expectedAtomic} atomic`
      };
    }
    if (calldataAmount !== payloadAmount) {
      return { ok: false, reason: 'payload amount does not match transfer calldata amount' };
    }

    // Derive the tx hash (deterministic from the signed raw tx)
    let hash;
    try {
      hash = ethers.keccak256(payload.transaction);
    } catch (e) {
      return { ok: false, reason: 'could not derive transaction hash' };
    }

    return {
      ok: true,
      payload,
      tx,
      sender,
      hash,
      nonce: tx.nonce,
      amount: calldataAmount
    };
  } catch (e) {
    // Absolute fail-closed: anything unexpected is a rejection.
    return { ok: false, reason: `unexpected validation error: ${e.message}` };
  }
}

module.exports = { parsePayment };
