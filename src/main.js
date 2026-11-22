'use strict';

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  shell,
  clipboard,
} = require('electron');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');
const sdkPackage = require('@smartspectra/node-sdk/package.json');

const { HypeDetector } = require('./engine/hype-detector');
const { ObsClient } = require('./engine/obs-client');
const { buildExport, suggestFilename, EXPORT_FORMATS } = require('./engine/exporter');
const { OverlayServer } = require('./server/overlay-server');
const { validationLabel } = require('./shared/validation');

const HOST = '127.0.0.1';
const PORT = 4789;
const OVERLAY_URL = `http://${HOST}:${PORT}/overlay`;
const OBS_URL = (process.env.OBS_WS_URL || 'ws://127.0.0.1:4455').trim();
const MAX_EVENTS = 200;

const state = {
  win: null,
  consent: false,
  mode: null,
  lastSessionMode: null,
  status: 'idle',
  sessionStartMs: null,
  sessionEndMs: null,
  detector: null,
  clips: [],
  lastClip: null,
  lastTelemetry: null,
  lastFrameAt: 0,
  packetCount: 0,
  fps: 0,
  bpm: null,
  breathRate: null,
  confidence: 0,
  stable: false,
  validationCode: 10,
  validationState: 'CAMERA TUNING',
  validationHint: '',
  baselineBpm: null,
  baselineStd: null,
  baselineBreathRate: null,
  baselineReady: false,
  warmupRemaining: 0,
  cooldownRemaining: 0,
  sustainedMs: 0,
  hypeScore: 0,
  components: null,
  expression: null,
  expressionBoost: false,
  threshold: 70,
  sustainMs: 2500,
  cooldownMs: 30000,
  preRollSec: 20,
  postRollSec: 10,
  warmupMs: 20000,
  baselineWindowMs: 120000,
  apiKeyEnv: (process.env.SMARTSPECTRA_API_KEY || '').trim(),
  apiKeyRuntime: '',
  obsPassword: process.env.OBS_WS_PASSWORD || '',
  obsUrl: OBS_URL,
  obsAutoConnect: false,
  obsStatus: {
    status: 'offline',
    connected: false,
    url: OBS_URL,
    error: null,
    replayActive: null,
    recordActive: null,
    lastAction: null,
  },
  server: null,
  serverStatus: 'idle',
  serverError: null,
  overlayClients: 0,
  lastError: null,
  events: [],
  lastBroadcastAt: 0,
  broadcastTimer: null,
  killFallback: null,
  quitting: false,
};

function currentApiKey() {
  return (state.apiKeyRuntime || state.apiKeyEnv || '').trim();
}

function effectiveConfig() {
  return {
    threshold: state.threshold,
    sustainMs: state.sustainMs,
    cooldownMs: state.cooldownMs,
    preRollSec: state.preRollSec,
    postRollSec: state.postRollSec,
    warmupMs: state.warmupMs,
    baselineWindowMs: state.baselineWindowMs,
    minConfidence: 0.4,
    minBaselineSamples: 6,
    expressionBoost: state.expressionBoost,
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pushEvent(kind, text, extra = {}) {
  const event = {
    t: Date.now(),
    kind,
    text: String(text || '').slice(0, 400),
    ...extra,
  };
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) state.events.shift();
  if (state.win && !state.win.isDestroyed()) {
    state.win.webContents.send('clippulse:event', event);
  }
  return event;
}

function clearTelemetryBuffers() {
  state.lastTelemetry = null;
  state.lastFrameAt = 0;
  state.packetCount = 0;
  state.fps = 0;
  state.bpm = null;
  state.breathRate = null;
  state.confidence = 0;
  state.stable = false;
  state.validationCode = 10;
  state.validationState = 'CAMERA TUNING';
  state.validationHint = '';
  state.baselineBpm = null;
  state.baselineStd = null;
  state.baselineBreathRate = null;
  state.baselineReady = false;
  state.warmupRemaining = 0;
  state.cooldownRemaining = 0;
  state.sustainedMs = 0;
  state.hypeScore = 0;
  state.components = null;
  state.expression = null;
}

function sanitizeTrace(input, maxPoints) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const value of input.slice(-maxPoints)) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    out.push(Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000);
  }
  return out;
}

function sanitizeExpression(input) {
  if (!input || typeof input !== 'object') return null;
  const pick = (key) => {
    const n = Number(input[key]);
    return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 100) / 100 : 0;
  };
  return { surprise: pick('surprise'), happy: pick('happy'), fear: pick('fear') };
}

function sanitizeFrame(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const bpmRaw = Number(raw.bpm);
  const breathRaw = Number(raw.breathRate);
  const confidenceRaw = Number(raw.confidence);
  const validationCode = Number.isInteger(raw.validationCode) ? raw.validationCode : 1;

  return {
    t: Number.isFinite(Number(raw.t)) ? Number(raw.t) : Date.now(),
    mode: raw.mode === 'simulator' ? 'simulator' : 'live',
    bpm: Number.isFinite(bpmRaw) && bpmRaw > 0 ? Math.min(250, Math.max(20, bpmRaw)) : null,
    breathRate: Number.isFinite(breathRaw) ? Math.min(80, Math.max(0, breathRaw)) : null,
    confidence: Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0,
    stable: raw.stable === true,
    validationCode,
    validationState: typeof raw.validationState === 'string'
      ? raw.validationState.slice(0, 40)
      : validationLabel(validationCode),
    validationHint: typeof raw.validationHint === 'string'
      ? raw.validationHint.slice(0, 160)
      : '',
    packetCount: Math.max(0, Math.floor(Number(raw.packetCount) || 0)),
    fps: clampNumber(raw.fps, 0, 240, 0),
    pulseTrace: sanitizeTrace(raw.pulseTrace, 160),
    breathTrace: sanitizeTrace(raw.breathTrace, 80),
    expression: sanitizeExpression(raw.expression),
  };
}

function buildOverlayState() {
  const sessionSec = state.sessionStartMs
    ? Math.max(0, (Date.now() - state.sessionStartMs) / 1000)
    : 0;
  const deltaBpm = state.bpm != null && state.baselineBpm != null
    ? round(state.bpm - state.baselineBpm, 1)
    : null;

  return {
    v: 1,
    t: Date.now(),
    mode: state.mode === 'live' ? 'LIVE' : state.mode === 'simulator' ? 'SIMULATOR' : 'IDLE',
    status: state.status === 'live' && !state.baselineReady ? 'warmup' : state.status,
    bpm: state.bpm,
    baselineBpm: state.baselineBpm,
    deltaBpm,
    breathRate: state.breathRate,
    baselineBreathRate: state.baselineBreathRate,
    confidence: state.confidence,
    stable: state.stable,
    validationState: state.validationState,
    validationCode: state.validationCode,
    hypeScore: state.hypeScore,
    threshold: state.threshold,
    baselineReady: state.baselineReady,
    warmupRemaining: state.warmupRemaining,
    cooldownRemaining: state.cooldownRemaining,
    packetCount: state.packetCount,
    fps: state.fps,
    sessionSec,
    pulseTrace: state.lastTelemetry ? state.lastTelemetry.pulseTrace : [],
    breathTrace: state.lastTelemetry ? state.lastTelemetry.breathTrace : [],
    expressionBoost: state.expressionBoost,
    expression: state.expression,
    lastClip: state.lastClip,
    clients: state.overlayClients,
  };
}

function buildRendererState() {
  return {
    status: state.status,
    mode: state.mode,
    consent: state.consent,
    sessionStartMs: state.sessionStartMs,
    sessionEndMs: state.sessionEndMs,
    elapsedSec: state.sessionStartMs
      ? Math.max(0, ((state.sessionEndMs || Date.now()) - state.sessionStartMs) / 1000)
      : 0,
    packetCount: state.packetCount,
    fps: state.fps,
    bpm: state.bpm,
    breathRate: state.breathRate,
    confidence: state.confidence,
    stable: state.stable,
    validationCode: state.validationCode,
    validationState: state.validationState,
    validationHint: state.validationHint,
    baselineBpm: state.baselineBpm,
    baselineStd: state.baselineStd,
    baselineBreathRate: state.baselineBreathRate,
    baselineReady: state.baselineReady,
    warmupRemaining: state.warmupRemaining,
    cooldownRemaining: state.cooldownRemaining,
    sustainedMs: state.sustainedMs,
    hypeScore: state.hypeScore,
    components: state.components,
    threshold: state.threshold,
    sustainMs: state.sustainMs,
    cooldownMs: state.cooldownMs,
    preRollSec: state.preRollSec,
    postRollSec: state.postRollSec,
    expressionBoost: state.expressionBoost,
    expression: state.expression,
    clips: state.clips,
    lastClip: state.lastClip,
    obs: state.obsStatus,
    server: {
      status: state.serverStatus,
      error: state.serverError,
      url: state.server ? state.server.url : OVERLAY_URL,
      clients: state.overlayClients,
    },
    error: state.lastError,
    config: effectiveConfig(),
  };
}

function broadcastNow() {
  if (state.server) state.server.broadcastState(buildOverlayState());
  if (state.win && !state.win.isDestroyed()) {
    state.win.webContents.send('clippulse:state', buildRendererState());
  }
}

function scheduleBroadcast(immediate = false) {
  const now = Date.now();
  const elapsed = now - state.lastBroadcastAt;
  if (immediate || elapsed >= 80) {
    state.lastBroadcastAt = now;
    broadcastNow();
    return;
  }
  if (state.broadcastTimer) return;
  state.broadcastTimer = setTimeout(() => {
    state.broadcastTimer = null;
    state.lastBroadcastAt = Date.now();
    broadcastNow();
  }, Math.max(10, 80 - elapsed));
}

async function ensureServer() {
  if (state.server) return { ok: true, url: state.server.url };

  const server = new OverlayServer({
    port: PORT,
    host: HOST,
    getSnapshot: buildOverlayState,
    onClientCount: (count) => {
      state.overlayClients = count;
      scheduleBroadcast();
    },
  });

  try {
    const url = await server.start();
    state.server = server;
    state.serverStatus = 'listening';
    state.serverError = null;
    pushEvent('server', `Overlay server listening at ${url}`);
    return { ok: true, url };
  } catch (err) {
    state.serverStatus = 'error';
    state.serverError = err && err.message ? err.message : String(err);
    pushEvent('server-error', `Overlay server could not bind ${HOST}:${PORT}: ${state.serverError}`);
    return { ok: false, error: state.serverError };
  }
}

const obs = new ObsClient({
  url: state.obsUrl,
  password: state.obsPassword,
  onStatus: (status) => {
    state.obsStatus = status;
    scheduleBroadcast();
  },
});

function createDetector() {
  state.warmupMs = state.mode === 'simulator' ? 12000 : 20000;
  state.detector = new HypeDetector(effectiveConfig());
  state.detector.start(Date.now());
}

async function handleClip(clip) {
  const enriched = {
    ...clip,
    mode: state.mode,
    obs: null,
  };
  state.clips.push(enriched);
  state.lastClip = enriched;

  pushEvent('clip', `Peak moment ${enriched.id}: ${enriched.reason}`, {
    clipId: enriched.id,
    deltaBpm: enriched.deltaBpm,
  });

  if (state.win && !state.win.isDestroyed()) {
    state.win.webContents.send('clippulse:clip', enriched);
  }
  if (state.server) state.server.broadcastClip(enriched);

  // Always record the OBS outcome, including the offline case, so the clip
  // row can show OBS OFFLINE instead of an ambiguous dash.
  obs.onClip(enriched)
    .then((result) => {
      enriched.obs = result;
      scheduleBroadcast(true);
    })
    .catch((err) => {
      enriched.obs = { attempted: true, replay: 'failed', chapter: 'failed' };
      pushEvent('obs-error', `OBS action failed: ${err && err.message ? err.message : err}`);
      scheduleBroadcast(true);
    });

  scheduleBroadcast(true);
}

function ingestFrame(raw) {
  if (!state.mode || !state.detector) return;
  const frame = sanitizeFrame(raw);
  if (!frame) return;

  state.lastTelemetry = frame;
  state.lastFrameAt = Date.now();
  state.packetCount = frame.packetCount;
  state.fps = frame.fps;
  state.bpm = frame.bpm;
  state.breathRate = frame.breathRate;
  state.confidence = frame.confidence;
  state.stable = frame.stable;
  state.validationCode = frame.validationCode;
  state.validationState = frame.validationState;
  state.validationHint = frame.validationHint;
  state.expression = frame.expression;

  if (state.status === 'starting') state.status = 'live';

  const result = state.detector.ingest({
    t: frame.t,
    bpm: frame.bpm,
    confidence: frame.confidence,
    stable: frame.stable,
    validationCode: frame.validationCode,
    breathRate: frame.breathRate,
    breathTrace: frame.breathTrace,
    expression: frame.expression,
  });

  state.hypeScore = result.score;
  state.components = result.components;
  state.baselineReady = result.baselineReady;
  state.warmupRemaining = result.warmupRemaining;
  state.cooldownRemaining = result.cooldownRemaining;
  state.sustainedMs = result.sustainedMs;
  state.baselineBpm = state.detector.baseline.bpm;
  state.baselineStd = state.detector.baseline.std;
  state.baselineBreathRate = state.detector.baseline.breathRate;
  state.threshold = state.detector.config.threshold;

  if (result.clip) {
    handleClip(result.clip);
  } else {
    scheduleBroadcast();
  }
}

async function startSession(payload = {}) {
  const mode = payload.mode === 'simulator' ? 'simulator' : 'live';

  if (mode === 'live' && state.consent !== true) {
    throw new Error('Consent is required before camera access.');
  }
  if (mode === 'live' && !currentApiKey()) {
    throw new Error('No SmartSpectra API key. Add SMARTSPECTRA_API_KEY to .env or paste a key on the launch screen.');
  }

  if (state.mode) await stopSession({ keepClips: false });

  // stopSession revokes consent by design; the live path already verified it
  // above, so restore it for this new session.
  if (mode === 'live') state.consent = true;

  state.mode = mode;
  state.lastSessionMode = mode;
  state.status = 'starting';
  state.sessionStartMs = Date.now();
  state.sessionEndMs = null;
  state.clips = [];
  state.lastClip = null;
  state.lastError = null;
  state.expressionBoost = payload.expressionBoost === true;
  state.obsAutoConnect = payload.autoObs === true;
  state.threshold = clampNumber(payload.threshold, 40, 95, 70);
  state.sustainMs = clampNumber(payload.sustainMs, 1000, 6000, 2500);
  state.cooldownMs = clampNumber(payload.cooldownMs, 10000, 120000, 30000);
  clearTelemetryBuffers();
  createDetector();

  const serverResult = await ensureServer();
  if (state.obsAutoConnect) {
    obs.connect({ url: state.obsUrl, password: state.obsPassword }).catch(() => {});
  }

  pushEvent('session', `${mode === 'simulator' ? 'SIMULATOR' : 'LIVE'} session armed.`);
  scheduleBroadcast(true);

  return {
    mode,
    apiKey: mode === 'live' ? currentApiKey() : '',
    overlayUrl: serverResult.url || OVERLAY_URL,
    server: serverResult,
    config: effectiveConfig(),
  };
}

async function stopSession({ keepClips = true } = {}) {
  state.status = 'idle';
  state.mode = null;
  state.sessionEndMs = Date.now();
  state.consent = false;
  if (state.detector) state.detector.reset();
  clearTelemetryBuffers();
  if (!keepClips) {
    state.clips = [];
    state.lastClip = null;
    state.lastSessionMode = null;
  }
  pushEvent('session', 'Session stopped. Metric buffers cleared.');
  scheduleBroadcast(true);
  return { clips: state.clips };
}

function killCamera() {
  state.consent = false;
  state.status = 'idle';
  state.mode = null;
  state.lastSessionMode = null;
  state.sessionEndMs = Date.now();
  if (state.detector) state.detector.reset();
  state.clips = [];
  state.lastClip = null;
  state.lastError = null;
  clearTelemetryBuffers();

  pushEvent('kill', 'KILL CAMERA engaged. Consent revoked and buffers cleared.');

  if (state.win && !state.win.isDestroyed()) {
    state.win.webContents.send('clippulse:kill');
  }
  scheduleBroadcast(true);

  if (state.killFallback) clearTimeout(state.killFallback);
  state.killFallback = setTimeout(() => {
    state.killFallback = null;
    if (state.win && !state.win.isDestroyed()) {
      pushEvent('kill', 'Renderer did not acknowledge the kill in time. Reloading the window.');
      state.win.webContents.reload();
    }
  }, 3000);

  return { ok: true };
}

function exportContext() {
  return {
    clips: state.clips,
    startedAtMs: state.sessionStartMs || Date.now(),
    endedAtMs: state.sessionEndMs || Date.now(),
    mode: state.mode || state.lastSessionMode || 'live',
    config: effectiveConfig(),
    nowMs: Date.now(),
  };
}

function installIpc() {
  ipcMain.handle('app:preflight', () => ({
    hasEnvKey: !!state.apiKeyEnv,
    hasRuntimeKey: !!state.apiKeyRuntime,
    hasKey: !!currentApiKey(),
    sdkVersion: sdkPackage.version,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    platform: process.platform,
    port: PORT,
    overlayUrl: state.server ? state.server.url : OVERLAY_URL,
    obsUrl: state.obsUrl,
    obsPasswordSet: !!state.obsPassword,
    serverStatus: state.serverStatus,
    serverError: state.serverError,
  }));

  ipcMain.handle('consent:set', (_event, value) => {
    state.consent = value === true;
    pushEvent('consent', state.consent ? 'Camera consent granted.' : 'Camera consent revoked.');
    scheduleBroadcast();
    return { consent: state.consent };
  });

  ipcMain.handle('key:set', (_event, raw) => {
    const key = String(raw == null ? '' : raw).trim().slice(0, 1024);
    state.apiKeyRuntime = key;
    return {
      hasKey: !!currentApiKey(),
      hasRuntimeKey: !!state.apiKeyRuntime,
      hasEnvKey: !!state.apiKeyEnv,
    };
  });

  ipcMain.handle('session:start', async (_event, payload) => startSession(payload || {}));
  ipcMain.handle('session:stop', async () => stopSession({ keepClips: true }));

  ipcMain.handle('session:skip-warmup', () => {
    if (state.mode !== 'simulator' || !state.detector) {
      return { ok: false, error: 'Skip warm-up is available in SIMULATOR mode only.' };
    }
    const status = state.detector.skipWarmup(Date.now());
    pushEvent('sim', 'Simulator baseline primed.');
    scheduleBroadcast(true);
    return { ok: true, status };
  });

  ipcMain.handle('camera:kill', () => killCamera());
  ipcMain.on('camera:killed', () => {
    if (state.killFallback) {
      clearTimeout(state.killFallback);
      state.killFallback = null;
    }
  });

  ipcMain.on('telemetry:frame', (_event, frame) => {
    try {
      ingestFrame(frame);
    } catch (err) {
      pushEvent('engine-error', `Telemetry frame rejected: ${err && err.message ? err.message : err}`);
    }
  });

  ipcMain.on('telemetry:event', (_event, raw) => {
    if (!raw || typeof raw !== 'object') return;
    const kind = typeof raw.kind === 'string' ? raw.kind.slice(0, 32) : 'event';
    const text = typeof raw.text === 'string'
      ? raw.text.slice(0, 400)
      : typeof raw.message === 'string'
        ? raw.message.slice(0, 400)
        : kind;
    pushEvent(kind, text, {
      code: raw.code,
      retryable: raw.retryable,
      status: raw.status,
      validationCode: raw.code,
    });

    if (kind === 'error') {
      state.lastError = {
        t: Date.now(),
        code: raw.code,
        message: text,
        retryable: raw.retryable === true,
      };
      state.status = 'error';
      if (state.win && !state.win.isDestroyed()) {
        state.win.webContents.send('clippulse:toast', { kind: 'error', text });
      }
      scheduleBroadcast(true);
      return;
    }

    if (kind === 'status' && Number.isInteger(raw.status)) {
      if (raw.status === 2) state.status = 'starting';
      else if (raw.status === 3) state.status = 'live';
      else if (raw.status === 5) state.status = 'error';
      scheduleBroadcast();
    }
  });

  ipcMain.handle('settings:update', (_event, payload) => {
    const settings = payload && typeof payload === 'object' ? payload : {};
    if (Number.isFinite(settings.threshold)) {
      state.threshold = clampNumber(settings.threshold, 40, 95, state.threshold);
    }
    if (Number.isFinite(settings.sustainMs)) {
      state.sustainMs = clampNumber(settings.sustainMs, 1000, 6000, state.sustainMs);
    }
    if (Number.isFinite(settings.cooldownMs)) {
      state.cooldownMs = clampNumber(settings.cooldownMs, 10000, 120000, state.cooldownMs);
    }
    if (typeof settings.expressionBoost === 'boolean') {
      state.expressionBoost = settings.expressionBoost;
    }
    if (state.detector) {
      state.detector.configure({
        threshold: state.threshold,
        sustainMs: state.sustainMs,
        cooldownMs: state.cooldownMs,
        expressionBoost: state.expressionBoost,
      });
      state.threshold = state.detector.config.threshold;
    }
    scheduleBroadcast(true);
    return { config: effectiveConfig() };
  });

  ipcMain.handle('export:preview', (_event, format) => {
    const safeFormat = EXPORT_FORMATS.includes(format) ? format : 'edl';
    return { format: safeFormat, text: buildExport(safeFormat, exportContext()) };
  });

  ipcMain.handle('export:save', async (_event, format) => {
    const safeFormat = EXPORT_FORMATS.includes(format) ? format : 'edl';
    const text = buildExport(safeFormat, exportContext());
    const filters = {
      edl: [{ name: 'CMX 3600 EDL', extensions: ['edl'] }],
      txt: [{ name: 'Chapter list', extensions: ['txt'] }],
      json: [{ name: 'Session JSON', extensions: ['json'] }],
    }[safeFormat];

    const result = await dialog.showSaveDialog(state.win, {
      title: 'Export ClipPulse Session',
      defaultPath: path.join(app.getPath('documents'), suggestFilename(safeFormat)),
      filters,
    });

    if (result.canceled || !result.filePath) return { saved: false };
    await fs.promises.writeFile(result.filePath, text, 'utf8');
    pushEvent('export', `Exported ${safeFormat.toUpperCase()} to ${path.basename(result.filePath)}`);
    return {
      saved: true,
      path: result.filePath,
      bytes: Buffer.byteLength(text, 'utf8'),
    };
  });

  ipcMain.handle('obs:connect', async (_event, payload) => {
    const options = payload && typeof payload === 'object' ? payload : {};
    if (typeof options.password === 'string') state.obsPassword = options.password;
    const result = await obs.connect({ url: state.obsUrl, password: state.obsPassword });
    scheduleBroadcast(true);
    return result;
  });

  ipcMain.handle('obs:disconnect', () => {
    obs.disconnect();
    scheduleBroadcast(true);
    return { connected: false };
  });

  ipcMain.handle('overlay:url', () => ({
    url: state.server ? state.server.url : OVERLAY_URL,
    status: state.serverStatus,
    error: state.serverError,
  }));

  ipcMain.handle('overlay:open', async () => {
    const url = state.server ? state.server.url : OVERLAY_URL;
    await shell.openExternal(url);
    return { url };
  });

  ipcMain.handle('app:open-external', async (_event, rawUrl) => {
    let parsed;
    try {
      parsed = new URL(String(rawUrl));
    } catch {
      throw new Error('Invalid URL.');
    }
    const allowedHosts = new Set(['physiology.presagetech.com', 'github.com']);
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
      throw new Error('That link is not on the allowlist.');
    }
    await shell.openExternal(parsed.toString());
    return { opened: true };
  });

  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text == null ? '' : text).slice(0, 2_000_000));
    return { ok: true };
  });

  ipcMain.handle('demo:open-folder', async () => {
    const demoDir = path.join(__dirname, '..', 'demo-assets');
    if (!fs.existsSync(demoDir)) {
      await fs.promises.mkdir(demoDir, { recursive: true });
    }
    const err = await shell.openPath(demoDir);
    if (err) {
      throw new Error(err);
    }
    return { opened: true, path: demoDir };
  });

  ipcMain.handle('demo:sample-video-buffer', async () => {
    const videoPath = path.join(__dirname, '..', 'demo-assets', 'clippulse-sample-gameplay.mp4');
    if (!fs.existsSync(videoPath)) {
      throw new Error('Sample footage not found in demo-assets directory. Run npm run generate:demo to generate it.');
    }
    const buffer = await fs.promises.readFile(videoPath);
    return buffer;
  });

  ipcMain.handle('demo:highlights-video-buffer', async () => {
    const videoPath = path.join(__dirname, '..', 'demo-assets', 'clippulse-highlights.mp4');
    if (!fs.existsSync(videoPath)) {
      throw new Error('Conformed highlight reel not found in demo-assets directory. Run npm run render:highlights to generate it.');
    }
    const buffer = await fs.promises.readFile(videoPath);
    return buffer;
  });
}

function installPermissionHandlers() {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    const mediaTypes = (details && details.mediaTypes) || [];
    const cameraOnly = mediaTypes.length === 1 && mediaTypes[0] === 'video';
    const ownPage = url.startsWith('file://');
    const allowed = state.consent === true && permission === 'media' && cameraOnly && ownPage;

    if (!allowed) {
      pushEvent('permission', `Denied ${permission} request (${mediaTypes.join(',') || 'unknown'}) from ${url || 'unknown'}.`);
    }
    callback(allowed);
  });

  if (typeof session.defaultSession.setPermissionCheckHandler === 'function') {
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details) => {
      const url = (details && details.requestingUrl) || origin || (wc && wc.getURL()) || '';
      const mediaType = details && details.mediaType;
      const cameraOnly = !mediaType || mediaType === 'video';
      const ownPage = url.startsWith('file://');
      return state.consent === true && permission === 'media' && cameraOnly && ownPage;
    });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#191919',
    show: false,
    title: 'ClipPulse',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  state.win = win;
  bindSmartSpectraIpc(win);

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.on('closed', () => {
    state.win = null;
    cleanup();
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--capture')) {
    win.webContents.once('did-finish-load', async () => {
      try {
        console.log('[capture] Beginning automated demo asset recording...');
        await new Promise((r) => setTimeout(r, 1200));

        // 1. Capture gate
        const gateImg = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'gate-preview.png'), gateImg.toPNG());
        console.log('[capture] Gate captured to gate-preview.png');

        // 2. Launch simulator
        await win.webContents.executeJavaScript(`
          if (document.getElementById('startSimBtn')) {
            document.getElementById('startSimBtn').click();
          }
        `);
        await new Promise((r) => setTimeout(r, 1800));

        // 3. Load sample gameplay video into stage via authentic app action
        await win.webContents.executeJavaScript(`
          (async () => {
            if (typeof window.__clippulseLoadSample === 'function') {
              await window.__clippulseLoadSample();
            } else if (document.getElementById('nleProofBtn') && document.getElementById('nleLoadSampleBtn')) {
              document.getElementById('nleProofBtn').click();
              document.getElementById('nleLoadSampleBtn').click();
            }
            const stageVideo = document.getElementById('stageVideo');
            if (stageVideo) {
              stageVideo.currentTime = 8;
              stageVideo.loop = true;
              void stageVideo.play();
            }
          })()
        `);
        await new Promise((r) => setTimeout(r, 1000));

        // 4. Skip warmup to arm the auto-clipper immediately
        await win.webContents.executeJavaScript(`
          if (document.getElementById('simSkipBtn')) {
            document.getElementById('simSkipBtn').click();
          }
        `);
        await new Promise((r) => setTimeout(r, 800));

        const framesDir = path.join(__dirname, '..', '.frames');
        if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });
        const oldFrames = fs.readdirSync(framesDir);
        for (const file of oldFrames) {
          if (file.endsWith('.png')) fs.unlinkSync(path.join(framesDir, file));
        }

        let f = 0;
        // Capture 12 frames of normal gameplay and baseline pulse
        for (let i = 0; i < 12; i++, f++) {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(framesDir, `frame-${String(f).padStart(3, '0')}.png`), img.toPNG());
          await new Promise((r) => setTimeout(r, 85));
        }

        // 5. Inject combat spike (+18 BPM surge)
        await win.webContents.executeJavaScript(`
          if (document.getElementById('simSpikeBtn')) {
            document.getElementById('simSpikeBtn').click();
          }
        `);

        // Capture 30 frames during spike rise and auto-clip triggering
        for (let i = 0; i < 30; i++, f++) {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(framesDir, `frame-${String(f).padStart(3, '0')}.png`), img.toPNG());
          await new Promise((r) => setTimeout(r, 85));
        }

        // Wait for clip card to render in timeline
        for (let i = 0; i < 20; i++) {
          if (state.clips.length > 0) {
            await new Promise((r) => setTimeout(r, 400));
            break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }

        // 6. Capture crisp Studio preview
        const studioImg = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'studio-preview.png'), studioImg.toPNG());
        console.log('[capture] Studio captured to studio-preview.png');

        // Capture 10 frames with clip in timeline
        for (let i = 0; i < 10; i++, f++) {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(framesDir, `frame-${String(f).padStart(3, '0')}.png`), img.toPNG());
          await new Promise((r) => setTimeout(r, 90));
        }

        // 7. Open Highlight Reel & NLE Export modal
        await win.webContents.executeJavaScript(`
          if (document.getElementById('nleProofBtn')) {
            document.getElementById('nleProofBtn').click();
          }
        `);
        await new Promise((r) => setTimeout(r, 800));

        // 8. Capture export-dialog-preview.png
        const dialogImg = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'export-dialog-preview.png'), dialogImg.toPNG());
        console.log('[capture] Export dialog captured to export-dialog-preview.png');

        // Capture 15 frames showing the conformed multi-track NLE dialog
        for (let i = 0; i < 15; i++, f++) {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(framesDir, `frame-${String(f).padStart(3, '0')}.png`), img.toPNG());
          await new Promise((r) => setTimeout(r, 100));
        }

        // 9. Click "Play Cut Highlights (.mp4)"
        await win.webContents.executeJavaScript(`
          if (document.getElementById('nlePlayHighlightsBtn')) {
            document.getElementById('nlePlayHighlightsBtn').click();
          }
        `);
        await new Promise((r) => setTimeout(r, 700));

        // Capture 18 frames of conformed highlight reel playing in stage
        for (let i = 0; i < 18; i++, f++) {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(framesDir, `frame-${String(f).padStart(3, '0')}.png`), img.toPNG());
          await new Promise((r) => setTimeout(r, 100));
        }

        // 10. Compile smooth, high-fidelity clippulse-demo.gif with FFmpeg palettegen
        console.log(`[capture] Compiling ${f} frames into clippulse-demo.gif ...`);
        try {
          const { execSync } = require('child_process');
          execSync(
            'ffmpeg -y -framerate 12 -i .frames/frame-%03d.png -vf "fps=12,scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff:max_colors=160[p];[s1][p]paletteuse=dither=floyd_steinberg" clippulse-demo.gif',
            {
              cwd: path.join(__dirname, '..'),
              stdio: 'inherit',
            }
          );
          console.log('[capture] Compiled clippulse-demo.gif successfully.');
          if (fs.existsSync(framesDir)) {
            fs.rmSync(framesDir, { recursive: true, force: true });
          }
        } catch (gifErr) {
          console.warn('[capture] GIF compilation notice:', gifErr.message);
        }
      } catch (err) {
        console.error('[capture] Error during capture:', err);
      } finally {
        try {
          const framesDir = path.join(__dirname, '..', '.frames');
          if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
        } catch { /* ignore */ }
        app.quit();
      }
    });
  }

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

let cleanedUp = false;
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  if (state.broadcastTimer) {
    clearTimeout(state.broadcastTimer);
    state.broadcastTimer = null;
  }
  if (state.killFallback) {
    clearTimeout(state.killFallback);
    state.killFallback = null;
  }
  if (state.detector) state.detector.reset();
  state.clips = [];
  state.lastClip = null;
  clearTelemetryBuffers();

  try { obs.disconnect(); } catch { /* ignore */ }
  if (state.server) {
    const server = state.server;
    state.server = null;
    try { await server.stop(); } catch { /* ignore */ }
  }
}

app.setAppUserModelId('com.clippulse.app');

app.whenReady().then(async () => {
  installPermissionHandlers();
  installIpc();
  await ensureServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (state.quitting) return;
  state.quitting = true;
  event.preventDefault();
  cleanup()
    .catch(() => {})
    .finally(() => app.exit(0));
});
