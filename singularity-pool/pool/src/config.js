export const VERSION = '1.7.0';
// SINGULARITY config.js
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
// fail FAST and LOUD on a mistyped numeric env — better than silently running
// the whole pool (difficulty, ports, timers) on a sticky NaN.
const num = (k, d) => {
  const v = env(k, d), n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`config: ${k}="${v}" is not a valid number`);
  return n;
};
const hex32 = (k, d) => {
  const v = env(k, d), n = parseInt(v, 16);
  if (!Number.isFinite(n)) throw new Error(`config: ${k}="${v}" is not valid hex`);
  return n >>> 0;
};
const bool = (k, d) => String(env(k, d)).toLowerCase() === 'true';

export const CONFIG = {
  rpcUrl: env('RPC_URL', 'http://10.21.21.8:8332/'),
  rpcUser: env('RPC_USER', 'umbrel'),
  rpcPass: env('RPC_PASS', ''),
  zmqBlocks: env('ZMQ_BLOCKS', 'tcp://10.21.21.8:28334,tcp://10.21.21.8:28332').split(',').map(s => s.trim()).filter(Boolean),
  network: env('BITCOIN_NETWORK', 'mainnet'),
  payoutAddress: env('PAYOUT_ADDRESS', ''),
  coinbaseTag: env('COINBASE_TAG', '/SINGULARITY/'),
  stratumPort: num('STRATUM_PORT', 2038),
  stratumBind: env('STRATUM_BIND', '0.0.0.0'),
  dashboardPort: num('DASHBOARD_PORT', 3337),
  dashboardBind: env('DASHBOARD_BIND', '0.0.0.0'),

  extranonce1Size: num('EXTRANONCE1_SIZE', 4),
  extranonce2Size: num('EXTRANONCE2_SIZE', 8),
  versionMask: hex32('VERSION_MASK', '1fffe000'),

  startDiff: num('START_DIFFICULTY', 1024),
  minDiff: num('MIN_DIFFICULTY', 256),
  maxDiff: num('MAX_DIFFICULTY', 0), // 0 = unlimited
  targetShareSecs: num('TARGET_SHARE_SECS', 8),
  retargetSecs: num('RETARGET_SECS', 30),

  templateRefreshMs: num('TEMPLATE_REFRESH_MS', 30000),
  pollFallbackMs: num('POLL_FALLBACK_MS', 1000),
  instantEmptyJob: bool('INSTANT_EMPTY_JOB', 'true'),
  staleGraceMs: num('STALE_GRACE_MS', 3000),
  workerIdleSecs: num('WORKER_IDLE_SECS', 300),

  dataDir: env('DATA_DIR', '/data'),
};
