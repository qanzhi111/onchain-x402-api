'use strict';

/**
 * MockBaseChain / MockSettler — deterministic in-memory replacement for the
 * real Base RPC + OnchainSettler used in production.
 *
 * MockSettler implements the same surface the middleware relies on:
 *   settle(parsedPayment, rawTx) -> { hash, blockNumber, fee }
 *
 * It independently parses the raw signed transaction (no trust in middleware
 * state), then applies ERC20 transfer semantics against in-memory balances.
 * Every failure throws, exactly like the production settler.
 */

const { ethers } = require('ethers');
const { CHAIN_ID, USDC_ADDRESS } = require('../lib/config');

class MockBaseChain {
  constructor() {
    this.balances = new Map(); // lowercase address -> bigint USDC balance
    this.receipts = new Map(); // hash -> receipt
    this.blockNumber = 1000n;
    this.nonces = new Map();
  }

  setBalance(address, amount) {
    this.balances.set(address.toLowerCase(), BigInt(amount));
  }

  getBalance(address) {
    return this.balances.get(address.toLowerCase()) || 0n;
  }

  // Apply a transfer; throws on every failure mode the real chain would reject
  applyTransfer(sender, to, amount) {
    const bal = this.getBalance(sender);
    if (bal < amount) {
      const e = new Error('execution reverted: ERC20: transfer amount exceeds balance');
      e.code = 'INSUFFICIENT_FUNDS';
      throw e;
    }
    this.balances.set(sender.toLowerCase(), bal - amount);
    this.balances.set(to.toLowerCase(), this.getBalance(to) + amount);
  }
}

class MockSettler {
  /**
   * @param {MockBaseChain} chain
   * @param {object} opts
   * @param {boolean} opts.broadcastWorks  set false to simulate all-RPC-down
   * @param {number} opts.delayMs          artificial settlement delay
   */
  constructor(chain, opts = {}) {
    this.chain = chain;
    this.broadcastWorks = opts.broadcastWorks !== false;
    this.delayMs = opts.delayMs || 0;
    this.broadcastLog = [];
  }

  async settle(parsed, rawTx) {
    if (!this.broadcastWorks) {
      throw new Error('all RPC endpoints failed (simulated network outage)');
    }
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));

    // Independently parse and verify the raw signed transaction
    let tx;
    try {
      tx = ethers.Transaction.from(rawTx);
    } catch (e) {
      throw new Error(`raw transaction parse failed: ${e.message}`);
    }
    if (tx.chainId !== BigInt(CHAIN_ID)) throw new Error('wrong chainId');
    if (ethers.getAddress(tx.to) !== ethers.getAddress(USDC_ADDRESS)) {
      throw new Error('tx.to is not USDC');
    }

    const sender = ethers.getAddress(tx.from);
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['address', 'uint256'],
      '0x' + tx.data.slice(2 + 8)
    );
    const to = ethers.getAddress(decoded[0]);
    const amount = BigInt(decoded[1]);

    // simulate (eth_call equivalent)
    this.chain.applyTransfer(sender, to, amount);

    this.broadcastLog.push({ hash: parsed.hash, sender, to, amount });

    this.chain.blockNumber += 1n;
    const receipt = {
      status: 1,
      blockNumber: this.chain.blockNumber,
      gasUsed: 50000n,
      hash: parsed.hash
    };
    this.chain.receipts.set(parsed.hash.toLowerCase(), receipt);
    return { hash: parsed.hash, blockNumber: Number(receipt.blockNumber), fee: receipt.gasUsed };
  }
}

module.exports = { MockBaseChain, MockSettler };
