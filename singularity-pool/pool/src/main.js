// SINGULARITY main.js
import { CONFIG, VERSION } from './config.js';
import { Rpc } from './rpc.js';
import { ZmqBlockWatcher } from './zmtp.js';
import { TemplateManager } from './template.js';
import { Registry } from './registry.js';
import { StratumServer } from './stratum.js';
import { Dashboard } from './dashboard.js';
import { addressToScript } from './util.js';
import fs from 'node:fs';
import path from 'node:path';

// recent log lines kept in a bounded ring so the dashboard can serve them at
// /api/logs (no docker access needed). Bounded => no leak.
const logRing = [];
const ring = (line) => { logRing.push(line); if (logRing.length > 1000) logRing.shift(); };
const log = (m) => { const line = `${new Date().toISOString()} ${m}`; console.log(line); ring(line); };
// error-level: goes to stderr AND the ring, so /api/logs shows failures too
const logErr = (m) => { const line = `${new Date().toISOString()} ${m}`; console.error(line); ring(line); };

// long-run safety: any state we cannot reason about is worse than a restart.
// Log loudly and exit non-zero — docker's `restart: unless-stopped` revives us
// in seconds with a clean state (and miners reconnect automatically).
process.on('uncaughtException', (e) => { console.error(`FATAL uncaughtException: ${e?.stack || e}`); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(`FATAL unhandledRejection: ${e?.stack || e}`); process.exit(1); });

async function main() {
  log(`◉ SINGULARITY v${VERSION} solo pool starting`);
  // PAYOUT_ADDRESS is an OPTIONAL fallback for miners that connect without a
  // Bitcoin address as their username. Empty => "per-miner mode": every miner
  // MUST use its own address as the Stratum username (address-less miners are
  // rejected). This makes the pool safe to ship publicly with no default wallet.
  if (!CONFIG.payoutAddress) {
    log('⚠ no default PAYOUT_ADDRESS — per-miner mode: each miner must use its own Bitcoin address as the Stratum username (address-less miners are rejected; no funds ever go to anyone but the finder).');
  } else {
    try {
      const spk = addressToScript(CONFIG.payoutAddress, CONFIG.network);
      log(`payout (default): ${CONFIG.payoutAddress} -> scriptPubKey ${spk.toString('hex')}`);
      log('per-miner wallets: username "ADDRESS.worker" overrides the payout for that miner');
    } catch (e) { console.error(`PAYOUT_ADDRESS invalid for ${CONFIG.network}: ${e.message}`); process.exit(1); }
  }

  const rpc = new Rpc(CONFIG.rpcUrl, CONFIG.rpcUser, CONFIG.rpcPass);

  // wait for the node
  for (;;) {
    try {
      const info = await rpc.getBlockchainInfo();
      log(`node ok: chain=${info.chain} height=${info.blocks} ibd=${info.initialblockdownload}`);
      if (!info.initialblockdownload) break;
      log('node in initial block download, waiting 15s…');
    } catch (e) { log(`waiting for bitcoind: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 15000));
  }

  const tm = new TemplateManager(rpc, CONFIG);
  tm.on('log', log);

  const registry = new Registry(CONFIG);
  registry.on('block_found', (i) => log(`█ BLOCK ${i.height} ${i.hash} → ${i.submitResult}`));
  registry.on('log', logErr);   // registry-level warnings (e.g. block-persist failure) reach /api/logs

  const stratum = new StratumServer(CONFIG, tm, registry, rpc);
  stratum.on('log', log);

  const zmq = new ZmqBlockWatcher(CONFIG.zmqBlocks);
  zmq.on('hashblock', (h) => { tm.stats.zmqAlive = true; tm.onNewTip(h, 'zmq').catch((e) => log(`tip error: ${e.message}`)); });
  zmq.on('up', (e) => { tm.stats.zmqAlive = true; log(`zmq up: ${e}`); });
  zmq.on('down', (e) => { tm.stats.zmqAlive = zmq.anyAlive; log(`zmq down: ${e}`); });
  zmq.on('warn', (m) => logErr(`zmq parse warning: ${m}`));

  await tm.start();
  zmq.start();
  await stratum.listen();
  log(`stratum listening on ${CONFIG.stratumBind}:${CONFIG.stratumPort}`);

  const dash = new Dashboard(CONFIG, registry, tm, logRing);
  await dash.listen();
  log(`dashboard on http://${CONFIG.dashboardBind}:${CONFIG.dashboardPort}`);

  // ---- consensus self-audit ------------------------------------------------
  // Build a real block from the CURRENT template (deliberately unsolved PoW)
  // and ask the user's OWN bitcoind to validate it via GBT proposal mode.
  // "high-hash" = every other consensus rule passed (merkle root, witness
  // commitment, coinbase value/structure, BIP34 height, all txs) — the node
  // itself certifies that a found block WILL be accepted. Runs at startup and
  // every 10 minutes against the freshest template.
  async function selfAudit() {
    try {
      const a = await tm.selfAudit();
      if (a.ok === true) {
        const ej = a.emptyOk === true ? ' · instant-empty-job path certified too' : (a.emptyOk === false ? ` · 🟥 EMPTY-JOB PATH REJECTED: ${a.emptyReason}` : '');
        log(`✅ consensus self-audit PASSED @${a.height} (${a.txs} txs): node says "${a.reason}" — merkle, witness commitment, coinbase and payout all certified by your bitcoind${ej}`);
      } else if (a.ok === false) {
        logErr(`🟥 CONSENSUS SELF-AUDIT FAILED @${a.height}: node rejected our block construction with "${a.reason}" — DO NOT rely on this pool until resolved`);
      }
    } catch (e) {
      log(`self-audit skipped (${e.message}) — will retry`);
    }
  }
  setTimeout(selfAudit, 3000);
  setInterval(selfAudit, 10 * 60 * 1000).unref();

  // hourly heartbeat: one human log line + one JSON line appended to
  // DATA_DIR/stats.jsonl — everything needed to audit health and PROGRESS
  // over weeks. The honest solo yardstick is work done vs network difficulty:
  //   progress = Σ(credited diff) / networkDiff
  // i.e. how many blocks you'd expect from the work so far (1.0 = one block's
  // worth of work done; <1 = still building toward expectation; >1 = overdue).
  const startedAt = Date.now();
  setInterval(() => {
    const j = tm.current;
    const hr = registry.poolHashrate();
    const networkDiff = j?.networkDiff ?? 0;
    const progress = networkDiff > 0 ? registry.totalDiffSum / networkDiff : 0;
    log(`♥ heartbeat: miners=${registry.miners.size} hashrate=${(hr/1e12).toFixed(1)}TH acc=${registry.totalAccepted} rej=${registry.totalRejected} best=${(registry.bestShareEver/1e9).toFixed(2)}G work=${(registry.totalDiffSum/1e9).toFixed(2)}G progress=${progress.toFixed(4)} blocks=${registry.blocksFound.length} job=${j ? `${j.kind}@${j.height}` : 'none'} gbt=${tm.stats.gbtMs}ms zmq=${tm.stats.zmqAlive} empty=${tm.stats.emptyJobs} full=${tm.stats.fullJobs}`);
    try {
      const line = JSON.stringify({
        t: new Date().toISOString(), uptimeH: +((Date.now() - startedAt) / 3600000).toFixed(2),
        height: j?.height ?? null, miners: registry.miners.size, hashrate: Math.round(hr),
        accepted: registry.totalAccepted, rejected: registry.totalRejected,
        best: registry.bestShareEver, work: registry.totalDiffSum,
        networkDiff, progress: +progress.toFixed(6),
        blocks: registry.blocksFound.length, gbtMs: tm.stats.gbtMs, zmq: tm.stats.zmqAlive,
        emptyJobs: tm.stats.emptyJobs, fullJobs: tm.stats.fullJobs,
        retarget: tm.stats.retarget ?? null,
      });
      fs.appendFileSync(path.join(CONFIG.dataDir, 'stats.jsonl'), line + '\n');
    } catch { /* stats file is best-effort */ }
  }, 3600 * 1000).unref();

  const shutdown = () => { log('shutting down'); stratum.close(); dash.close(); zmq.stop(); tm.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
