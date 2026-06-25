// SINGULARITY dashboard.js — http + Server-Sent Events. No frameworks.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'static', 'index.html'));

export class Dashboard {
  constructor(cfg, registry, tm, logRing = []) {
    this.cfg = cfg;
    this.registry = registry;
    this.tm = tm;
    this.logRing = logRing;          // shared in-memory ring of recent log lines
    this.sseClients = new Set();
    this.server = http.createServer((req, res) => this.route(req, res));
    this.tick = setInterval(() => this.pushState(), 1000);
    registry.on('block_found', (info) => this.pushEvent('block', info));
    registry.on('best_share', (info) => this.pushEvent('best', info));
  }

  listen() {
    return new Promise((res) => this.server.listen(this.cfg.dashboardPort, this.cfg.dashboardBind, res));
  }
  close() { clearInterval(this.tick); this.server.close(); for (const r of this.sseClients) r.end(); }

  snap() {
    return { version: VERSION, ...this.registry.snapshot(this.tm.current, this.tm.stats) };
  }

  // config WITHOUT secrets — never expose rpcUser/rpcPass over HTTP
  safeConfig() {
    const c = this.cfg;
    return {
      network: c.network, payoutAddress: c.payoutAddress, coinbaseTag: c.coinbaseTag,
      rpcUrl: c.rpcUrl, zmqBlocks: c.zmqBlocks,        // host:port only, no creds live here
      stratumPort: c.stratumPort, dashboardPort: c.dashboardPort,
      extranonce1Size: c.extranonce1Size, extranonce2Size: c.extranonce2Size,
      versionMask: (c.versionMask >>> 0).toString(16),
      startDiff: c.startDiff, minDiff: c.minDiff, maxDiff: c.maxDiff,
      targetShareSecs: c.targetShareSecs, retargetSecs: c.retargetSecs,
      templateRefreshMs: c.templateRefreshMs, pollFallbackMs: c.pollFallbackMs,
      instantEmptyJob: c.instantEmptyJob, staleGraceMs: c.staleGraceMs,
      workerIdleSecs: c.workerIdleSecs,
      // intentionally omitted: rpcUser, rpcPass
    };
  }

  // tail of the hourly forensic log (no disk hit beyond a single read)
  statsHistory(n = 72) {
    try {
      const lines = fs.readFileSync(path.join(this.cfg.dataDir, 'stats.jsonl'), 'utf8').split('\n').filter(Boolean);
      return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }

  // ONE self-contained JSON blob: everything an operator or an AI needs to
  // analyse the pool's health, configuration, work and history — so you never
  // have to stitch together docker logs + dashboard + the box itself.
  diag() {
    const snap = this.snap();
    const r = this.registry;
    const now = Date.now();
    const totalShares = r.totalAccepted + r.totalRejected;
    const networkDiff = this.tm.current?.networkDiff ?? 0;
    const rejectTotals = { stale: 0, duplicate: 0, lowdiff: 0, format: 0, ntime: 0, version: 0 };
    for (const m of snap.miners) for (const k in rejectTotals) rejectTotals[k] += m.rejects?.[k] ?? 0;
    return {
      schema: 'singularity-diag/1',
      generatedAt: new Date(now).toISOString(),
      version: snap.version,
      uptimeSecs: Math.floor((now - r.startedAt) / 1000),
      config: this.safeConfig(),
      node: {
        chain: this.cfg.network, tipHash: this.tm.tipHash,
        height: snap.job?.height ?? null, networkDiff,
        gbtMs: this.tm.stats.gbtMs, zmqAlive: this.tm.stats.zmqAlive,
        emptyJobs: this.tm.stats.emptyJobs, fullJobs: this.tm.stats.fullJobs,
        retarget: this.tm.stats.retarget ?? null,
      },
      summary: {
        miners: snap.miners.length, poolHashrate: snap.poolHashrate,
        accepted: r.totalAccepted, rejected: r.totalRejected,
        rejectRate: totalShares > 0 ? +(r.totalRejected / totalShares).toFixed(4) : 0,
        rejectTotals,
        bestShareEver: r.bestShareEver, bestShareWorker: r.bestShareWorker,
        work: r.totalDiffSum,
        progress: networkDiff > 0 ? +(r.totalDiffSum / networkDiff).toFixed(6) : 0,
        blocksFound: r.blocksFound.length,
      },
      job: snap.job,
      miners: snap.miners,                 // full per-device stats incl. reject taxonomy
      blocksFound: r.blocksFound.slice(-25),
      statsHistory: this.statsHistory(72),  // last ~3 days of hourly samples
    };
  }

  route(req, res) {
    const url = req.url.split('?')[0];
    if (url === '/' || url === '/index.html') {
      // no-store: phones must NEVER show a stale dashboard after an update
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache' });
      return res.end(INDEX);
    }
    if (url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(this.snap()));
    }
    // one copy-paste blob for an operator or an AI — pretty-printed on purpose
    if (url === '/api/diag') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(this.diag(), null, 2));
    }
    // recent activity without `docker logs` — ?n=200 (default), ?format=text
    if (url === '/api/logs') {
      const q = new URLSearchParams(req.url.split('?')[1] || '');
      const n = Math.min(2000, Math.max(1, parseInt(q.get('n') || '200', 10) || 200));
      const lines = this.logRing.slice(-n);
      if (q.get('format') === 'text') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(lines.join('\n') + '\n');
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ count: lines.length, lines }));
    }
    // Umbrel home-screen widget (four-stats). Umbrel polls this endpoint and
    // renders the four cells on the dashboard tile.
    if (url === '/widget-api/stats') {
      const s = this.snap();
      const hr = s.poolHashrate || 0;
      const hrText = hr >= 1e15 ? (hr / 1e15).toFixed(2) + ' PH/s'
                   : hr >= 1e12 ? (hr / 1e12).toFixed(2) + ' TH/s'
                   : hr >= 1e9 ? (hr / 1e9).toFixed(2) + ' GH/s'
                   : (hr / 1e6).toFixed(2) + ' MH/s';
      const scale = (v) => { const u = ['', 'K', 'M', 'G', 'T', 'P']; let i = 0; while (v >= 1000 && i < 5) { v /= 1000; i++; } return v.toFixed(v >= 100 ? 0 : 2) + u[i]; };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({
        type: 'four-stats',
        refresh: '5s',
        link: '',
        items: [
          { title: 'Hash Rate', text: hrText },
          { title: 'Miners', text: String(s.miners?.length ?? 0) },
          { title: 'Blocks Found', text: String(s.blocksFound?.length ?? 0) },
          { title: 'Best Share', text: s.bestShareEver > 0 ? scale(s.bestShareEver) : '0' },
        ],
      }));
    }
    if (url === '/widget-api/height') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ height: this.snap().job?.height ?? 0 }));
    }
    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`event: state\ndata: ${JSON.stringify(this.snap())}\n\n`);
      this.sseClients.add(res);
      req.on('close', () => this.sseClients.delete(res));
      return;
    }
    res.writeHead(404); res.end('not found');
  }

  pushState() {
    if (this.sseClients.size === 0) return;
    const data = `event: state\ndata: ${JSON.stringify(this.snap())}\n\n`;
    for (const r of this.sseClients) { try { r.write(data); } catch { this.sseClients.delete(r); } }
  }

  pushEvent(name, payload) {
    const data = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const r of this.sseClients) { try { r.write(data); } catch { this.sseClients.delete(r); } }
  }
}
