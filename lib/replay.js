'use strict';

const fsp = require('fs/promises');
const path = require('path');

/**
 * ReplayGuard — fail-closed double-spend / replay protection.
 *
 * Tracks:
 *  - settled tx hashes (persisted to a local JSON file when the directory is writable)
 *  - settled (sender, nonce) pairs (protects against same-payment re-sign with altered fee)
 *  - in-flight tx hashes (concurrent duplicate submissions share the same settlement promise)
 */
class ReplayGuard {
  constructor({ filePath, maxPersisted = 50000 } = {}) {
    this.filePath = filePath;
    this.maxPersisted = maxPersisted;
    this.settledHashes = new Set();
    this.settledSenderNonces = new Set();
    this.inflight = new Map(); // hash -> Promise
    this._writeChain = Promise.resolve();
    this._loaded = false;
  }

  async load() {
    if (this._loaded || !this.filePath) return;
    this._loaded = true;
    try {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.hashes)) {
        data.hashes.slice(-this.maxPersisted).forEach((h) => this.settledHashes.add(h.toLowerCase()));
      }
      if (Array.isArray(data.senderNonces)) {
        data.senderNonces.slice(-this.maxPersisted).forEach((k) => this.settledSenderNonces.add(k));
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn(`[replay] could not read settlement file ${this.filePath}: ${e.message}`);
      }
    }
  }

  isSettledHash(hash) {
    return this.settledHashes.has(hash.toLowerCase());
  }

  isSettledSenderNonce(sender, nonce) {
    return this.settledSenderNonces.has(`${sender.toLowerCase()}:${nonce}`);
  }

  /**
   * Run settlement at most once per hash. Concurrent submissions of the same
   * tx await the same settlement promise instead of racing.
   */
  async withInflight(hash, fn) {
    const key = hash.toLowerCase();
    if (this.inflight.has(key)) {
      await this.inflight.get(key);
      // Whatever the outcome, a second submission after the first settled is a replay.
      const err = new Error('payment already submitted');
      err.code = 'REPLAY';
      throw err;
    }
    const p = (async () => {
      try {
        const r = await fn();
        return r;
      } finally {
        // small delay so a truly concurrent peer sees the inflight promise
        setTimeout(() => this.inflight.delete(key), 50);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  markSettled(hash, sender, nonce) {
    this.settledHashes.add(hash.toLowerCase());
    if (sender !== undefined && nonce !== undefined) {
      this.settledSenderNonces.add(`${sender.toLowerCase()}:${nonce}`);
    }
    this._schedulePersist();
  }

  _schedulePersist() {
    if (!this.filePath) return;
    this._writeChain = this._writeChain.then(async () => {
      try {
        const dir = path.dirname(this.filePath);
        await fsp.mkdir(dir, { recursive: true });
        const payload = {
          version: 1,
          updatedAt: new Date().toISOString(),
          hashes: Array.from(this.settledHashes).slice(-this.maxPersisted),
          senderNonces: Array.from(this.settledSenderNonces).slice(-this.maxPersisted)
        };
        const tmp = `${this.filePath}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(payload));
        await fsp.rename(tmp, this.filePath);
      } catch (e) {
        // Persistence is best-effort; in-memory guard still active.
        console.warn(`[replay] could not persist settlement file: ${e.message}`);
      }
    });
  }

  async flush() {
    await this._writeChain;
  }
}

module.exports = { ReplayGuard };
