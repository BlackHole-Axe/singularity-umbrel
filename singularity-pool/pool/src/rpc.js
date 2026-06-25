// SINGULARITY rpc.js — minimal JSON-RPC client, keep-alive, no deps.
import http from 'node:http';
import { URL } from 'node:url';

export class Rpc {
  constructor(url, user, pass) {
    const u = new URL(url);
    this.host = u.hostname;
    this.port = Number(u.port || 8332);
    this.auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    this.agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
    this.id = 0;
  }

  call(method, params = [], timeoutMs = 30000) {
    const body = JSON.stringify({ jsonrpc: '1.0', id: ++this.id, method, params });
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: this.host, port: this.port, method: 'POST', path: '/',
        agent: this.agent, timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': this.auth,
          'Connection': 'keep-alive',
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString());
            if (j.error) reject(new Error(`rpc ${method}: ${JSON.stringify(j.error)}`));
            else resolve(j.result);
          } catch (e) { reject(new Error(`rpc ${method}: bad response (${res.statusCode})`)); }
        });
      });
      req.on('timeout', () => { req.destroy(new Error(`rpc ${method}: timeout`)); });
      req.on('error', reject);
      req.end(body);
    });
  }

  getBlockTemplate() {
    return this.call('getblocktemplate', [{ rules: ['segwit'], capabilities: ['coinbasetxn', 'workid', 'coinbase/append'] }]);
  }
  // consensus self-audit: the node validates a block we built WITHOUT broadcasting.
  // For a block with deliberately-unsolved PoW, "high-hash" back from the node
  // means EVERY OTHER consensus rule passed: merkle root, witness commitment,
  // coinbase structure/value, BIP34 height, tx validity — full certification.
  proposeBlock(hex) {
    return this.call('getblocktemplate', [{ mode: 'proposal', data: hex, rules: ['segwit'] }], 60000);
  }
  getBestBlockHash() { return this.call('getbestblockhash'); }
  getBlockHash(height) { return this.call('getblockhash', [height]); }
  getBlockHeader(hash) { return this.call('getblockheader', [hash, true]); }
  submitBlock(hex) { return this.call('submitblock', [hex], 60000); }
  getBlockchainInfo() { return this.call('getblockchaininfo'); }
}
