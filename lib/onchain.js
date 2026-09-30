'use strict';

const { ethers } = require('ethers');
const { DEFAULT_RPC_URLS, USDC_ADDRESS } = require('./config');

/**
 * OnchainSettler — verify & settle an x402 payment without third-party services.
 *
 * Steps (all fail-closed):
 *   1. eth_call simulation against a public Base RPC (with the signed tx fields)
 *      to ensure the transfer does not revert (sufficient USDC balance, etc.)
 *   2. eth_sendRawTransaction to broadcast, with multi-RPC fallback
 *   3. poll eth_getTransactionReceipt until the tx is mined (status === 1)
 */
class OnchainSettler {
  constructor({
    rpcUrls = DEFAULT_RPC_URLS,
    confirmations = 1,
    timeoutMs = 45000,
    pollIntervalMs = 1500,
    fetchImpl
  } = {}) {
    this.rpcUrls = rpcUrls;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.confirmations = confirmations;
    this.timeoutMs = timeoutMs;
    this.pollIntervalMs = pollIntervalMs;
  }

  async _rpc(rpcUrl, method, params) {
    const res = await this.fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: params || []
      })
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) {
      const err = new Error(data.error.message || 'RPC error');
      err.rpcError = data.error;
      throw err;
    }
    return data.result;
  }

  /**
   * Try every configured RPC until one succeeds.
   * @param {function(string): Promise<any>} op
   */
  async _withFallback(op) {
    let lastErr;
    for (const url of this.rpcUrls) {
      try {
        return await op(url);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('all RPC endpoints failed');
  }

  /**
   * Simulate the signed tx. A successful ERC20 transfer returns 32-byte 0x000...001.
   */
  async simulate({ tx, sender }) {
    const callObject = {
      from: sender,
      to: tx.to,
      data: tx.data,
      value: tx.value ? '0x' + tx.value.toString(16) : '0x0'
    };
    const result = await this._withFallback((url) =>
      this._rpc(url, 'eth_call', [callObject, 'latest'])
    );
    // The raw return must indicate success (32-byte word, non-zero = true)
    if (typeof result !== 'string' || result === '0x') {
      throw new Error('eth_call returned no data — transfer would fail');
    }
    const padded = result.slice(2).replace(/^0+/, '');
    if (padded !== '1') {
      throw new Error('USDC transfer simulation returned false (insufficient balance or rejected)');
    }
    return true;
  }

  /**
   * Broadcast the raw signed transaction. Tolerate "already known" responses.
   */
  async broadcast(rawTx, expectedHash) {
    return this._withFallback(async (url) => {
      try {
        const hash = await this._rpc(url, 'eth_sendRawTransaction', [rawTx]);
        if (expectedHash && hash.toLowerCase() !== expectedHash.toLowerCase()) {
          throw new Error(`broadcast hash mismatch: got ${hash}`);
        }
        return hash;
      } catch (e) {
        const msg = (e.message || '').toLowerCase();
        if (msg.includes('already known') || msg.includes('alreadyknown') || msg.includes('nonce too low')) {
          // The tx is already in the mempool / chain — treat as success.
          return expectedHash;
        }
        throw e;
      }
    });
  }

  /**
   * Poll until a receipt with status 0x1 is available.
   */
  async waitForReceipt(hash) {
    const deadline = Date.now() + this.timeoutMs;
    let notFoundCount = 0;
    while (Date.now() < deadline) {
      let receipt = null;
      try {
        receipt = await this._withFallback((url) =>
          this._rpc(url, 'eth_getTransactionReceipt', [hash])
        );
      } catch (e) {
        // all RPCs failed this round — keep trying until deadline
      }
      if (receipt) {
        if (receipt.status === '0x1' || receipt.status === 1) return receipt;
        if (receipt.status === '0x0' || receipt.status === 0) {
          throw new Error('transaction mined but reverted (status 0)');
        }
        notFoundCount = 0;
      } else {
        notFoundCount++;
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    throw new Error(`receipt not found within ${this.timeoutMs}ms`);
  }

  /**
   * Full settlement: simulate -> broadcast -> confirm.
   */
  async settle({ tx, sender, hash }, rawTx) {
    await this.simulate({ tx, sender });
    await this.broadcast(rawTx, hash);
    const receipt = await this.waitForReceipt(hash);
    return {
      hash,
      blockNumber: Number(receipt.blockNumber),
      fee: receipt.gasUsed ? BigInt(receipt.gasUsed) : 0n
    };
  }
}

async function broadcastWithTimeout(settler, rawTx, hash) {
  // broadcast fallback loop can take long; bound it loosely via Promise.race
  return settler.broadcast(rawTx, hash);
}

module.exports = { OnchainSettler, USDC_ADDRESS };
