'use strict';

/**
 * Shared test helpers:
 *  - buildSignedTransfer(): construct a properly signed EIP-1559 ERC20 transfer
 *  - encodeX402Header(): wrap a payment object into the X-PAYMENT base64 header
 *  - startTestServer(): boot an Express app on an ephemeral port
 */

const { ethers } = require('ethers');
const path = require('path');
const fs = require('fs');

const { CHAIN_ID, USDC_ADDRESS, usdToAtomic } = require('../lib/config');

const PAY_TO = '0x801B27e126d91D99A70cd31ffc8BC867B329023D';

// Deterministic test wallets (well-known hardhat-style keys, FRESH test accounts)
const BUYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const BUYER_WALLET = new ethers.Wallet(BUYER_KEY);

/**
 * Build and sign an EIP-1559 transaction that calls USDC.transfer(payTo, amount).
 */
async function buildSignedTransfer({
  amountAtomic,
  payTo = PAY_TO,
  nonce = 0,
  wallet = BUYER_WALLET,
  to = USDC_ADDRESS,
  chainId = CHAIN_ID,
  value = 0n,
  overrides = {}
} = {}) {
  const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
  const data = iface.encodeFunctionData('transfer', [payTo, amountAtomic]);

  const tx = {
    to,
    value,
    data,
    nonce,
    chainId,
    type: 2,
    maxFeePerGas: overrides.maxFeePerGas || 1000000n, // 0.001 gwei
    maxPriorityFeePerGas: overrides.maxPriorityFeePerGas || 100000n,
    gasLimit: overrides.gasLimit || 100000n
  };

  const signed = await wallet.signTransaction(tx);
  const parsed = ethers.Transaction.from(signed);
  return { raw: signed, tx: parsed, hash: ethers.keccak256(signed), sender: wallet.address };
}

/**
 * Build the base64-encoded X-PAYMENT header for a signed transaction.
 */
function encodeX402Header({ raw, amountAtomic, payTo = PAY_TO, asset = USDC_ADDRESS, extra } = {}) {
  const payload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    asset,
    payTo,
    amount: Number(amountAtomic),
    transaction: raw,
    ...(extra || {})
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function startTestServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
    server.on('error', reject);
  });
}

module.exports = {
  PAY_TO,
  BUYER_KEY,
  BUYER_WALLET,
  buildSignedTransfer,
  encodeX402Header,
  startTestServer,
  usdToAtomic
};
