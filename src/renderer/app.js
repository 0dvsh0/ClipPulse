'use strict';

// ClipPulse studio controller.
//
// The renderer owns camera capture through the SmartSpectra renderer SDK,
// because only the renderer can hold the MediaStream used by the faceless
// preview. Everything numeric is forwarded to the main process over IPC; no
// video ever crosses that boundary. The main process owns the detector, clip
// list, overlay server, OBS client, and exports.

const { SignalProvider } = require('../engine/signal-provider');

const api = window.clippulse;
const SVG_NS = 'http://www.w3.org/2000/svg';
const BLUR_SECONDS = 5;
const OVERLAY_FALLBACK = 'http://127.0.0.1:4789/overlay';

const $ = (id) => document.getElementById(id);

const dom = {
  // gate
  gateScreen: $('gateScreen'),
  gateServerPill: $('gateServerPill'),
  gateServerStatus: $('gateServerStatus'),
  gateCameraPill: $('gateCameraPill'),
  gateCameraStatus: $('gateCameraStatus'),
  consentCheck: $('consentCheck'),
  apiKeyInput: $('apiKeyInput'),
  keyToggleBtn: $('keyToggleBtn'),
  keyStatus: $('keyStatus'),
  previewFacelessCheck: $('previewFacelessCheck'),
  expressionBoostCheck: $('expressionBoostCheck'),
  autoObsCheck: $('autoObsCheck'),
  startLiveBtn: $('startLiveBtn'),
  startSimBtn: $('startSimBtn'),
  gateNote: $('gateNote'),
  gateStatus: $('gateStatus'),
  versionLabel: $('versionLabel'),
  sdkLabel: $('sdkLabel'),
  electronLabel: $('electronLabel'),

  // header
  studioScreen: $('studioScreen'),
  sessionModeChip: $('sessionModeChip'),
  simHeaderBadge: $('simHeaderBadge'),
  sessionClock: $('sessionClock'),
  sessionStatusText: $('sessionStatusText'),
  hudClients: $('hudClients'),
  obsChip: $('obsChip'),
  obsChipText: $('obsChipText'),
  inspectorJumpBtn: $('inspectorJumpBtn'),
  settingsJumpBtn: $('settingsJumpBtn'),
  stopSessionBtn: $('stopSessionBtn'),
  cameraPill: $('cameraPill'),
  cameraPillLabel: $('cameraPill').querySelector('b'),
  killBtn: $('killBtn'),

  // privacy
  privacyState: $('privacyState'),
  alignHoldBtn: $('alignHoldBtn'),
  alignProgress: $('alignProgress'),
  alignFill: $('alignFill'),
  alignCount: $('alignCount'),
  numericOnlyCheck: $('numericOnlyCheck'),

  // banners
  sessionBanner: $('sessionBanner'),
  sessionBannerTitle: $('sessionBannerTitle'),
  reviewClipsBtn: $('reviewClipsBtn'),
  newSessionBtn: $('newSessionBtn'),
  simConsole: $('simConsole'),
  simSpikeBtn: $('simSpikeBtn'),
  simGaspBtn: $('simGaspBtn'),
  simLeanBtn: $('simLeanBtn'),
  simSkipBtn: $('simSkipBtn'),
  simResetBtn: $('simResetBtn'),

  // stage
  stagePanel: $('stagePanel'),
  themeSelect: $('themeSelect'),
  overlayToggle: $('overlayToggle'),
  stageWrap: $('stageWrap'),
  gameCanvas: $('gameCanvas'),
  stageVideo: $('stageVideo'),
  overlaySlot: $('overlaySlot'),
  overlayFrame: $('overlayFrame'),
  dropHint: $('dropHint'),
  stageSourceBadgeText: $('stageSourceBadgeText'),
  stageFlash: $('stageFlash'),
  stageSourceText: $('stageSourceText'),
  stageFileText: $('stageFileText'),
  videoFileInput: $('videoFileInput'),
  browseVideoBtn: $('browseVideoBtn'),
  resetStageBtn: $('resetStageBtn'),
  openOverlayBtn: $('openOverlayBtn'),
  copyOverlayBtn: $('copyOverlayBtn'),

  // timeline
  timelinePanel: $('timelinePanel'),
  clipCount: $('clipCount'),
  timelineObsState: $('timelineObsState'),
  timelineEmpty: $('timelineEmpty'),
  timelineList: $('timelineList'),

  // signal
  signalPanel: $('signalPanel'),
  signalSourceChip: $('signalSourceChip'),
  cameraFrame: $('cameraFrame'),
  previewVideo: $('previewVideo'),
  simScope: $('simScope'),
  facelessVeil: $('facelessVeil'),
  cameraPlaceholder: $('cameraPlaceholder'),
  numericCard: $('numericCard'),
  numericBpm: $('numericBpm'),
  numericDelta: $('numericDelta'),
  numericBreath: $('numericBreath'),
  numericValidation: $('numericValidation'),
  numericConfidence: $('numericConfidence'),
  cameraFrameLabel: $('cameraFrameLabel'),
  cameraFrameValidation: $('cameraFrameValidation'),
  cameraFrameHint: $('cameraFrameHint'),
  cameraFrameMode: $('cameraFrameMode'),
  signalBpm: $('signalBpm'),
  signalDelta: $('signalDelta'),
  signalBreath: $('signalBreath'),
  signalConf: $('signalConf'),
  signalValidation: $('signalValidation'),
  signalHint: $('signalHint'),

  // hype
  hypePanel: $('hypePanel'),
  detectorState: $('detectorState'),
  hypeScore: $('hypeScore'),
  hypeThresholdValue: $('hypeThresholdValue'),
  hypeSustainValue: $('hypeSustainValue'),
  hypeBarFill: $('hypeBarFill'),
  hypeBarThreshold: $('hypeBarThreshold'),
  hypeBarSustain: $('hypeBarSustain'),
  hypeStatusLine: $('hypeStatusLine'),
  hypeCountdown: $('hypeCountdown'),
  compDeltaBar: $('compDeltaBar'),
  compDelta: $('compDelta'),
  compSlopeBar: $('compSlopeBar'),
  compSlope: $('compSlope'),
  compBreathBar: $('compBreathBar'),
  compBreath: $('compBreath'),
  compIrrBar: $('compIrrBar'),
  compIrr: $('compIrr'),
  compExprBar: $('compExprBar'),
  compExpr: $('compExpr'),
  baseBpm: $('baseBpm'),
  baseStd: $('baseStd'),
  baseBreath: $('baseBreath'),
  cooldownValue: $('cooldownValue'),

  // inspector
  inspectorPanel: $('inspectorPanel'),
  inspectorToggle: $('inspectorToggle'),
  inspectorBody: $('inspectorBody'),
  inspectorJson: $('inspectorJson'),
  inspectorEvents: $('inspectorEvents'),
  eventEmpty: $('eventEmpty'),
  eventList: $('eventList'),
  eventCount: $('eventCount'),
  inspectorUpdated: $('inspectorUpdated'),
  inspectorPackets: $('inspectorPackets'),
  inspectorLiveDot: $('inspectorLiveDot'),

  // setup
  setupPanel: $('setupPanel'),
  setupToggle: $('setupToggle'),
  setupBody: $('setupBody'),
  thresholdRange: $('thresholdRange'),
  thresholdOutput: $('thresholdOutput'),
  sustainRange: $('sustainRange'),
  sustainOutput: $('sustainOutput'),
  cooldownRange: $('cooldownRange'),
  cooldownOutput: $('cooldownOutput'),
  expressionBoostStudio: $('expressionBoostStudio'),
  obsStateChip: $('obsStateChip'),
  obsUrlLabel: $('obsUrlLabel'),
  obsPasswordInput: $('obsPasswordInput'),
  obsConnectBtn: $('obsConnectBtn'),
  obsDisconnectBtn: $('obsDisconnectBtn'),
  obsActionText: $('obsActionText'),

  // exports + footer
  exportPanel: $('exportPanel'),
  footerServerStatus: $('footerServerStatus'),
  footerOverlayUrl: $('footerOverlayUrl'),
  footerClients: $('footerClients'),
  footerPackets: $('footerPackets'),
  footerFps: $('footerFps'),
  toastStack: $('toastStack'),
  exportDialog: $('exportDialog'),
  dialogKicker: $('dialogKicker'),
  dialogTitle: $('dialogTitle'),
  exportPreviewText: $('exportPreviewText'),
  exportMeta: $('exportMeta'),
  dialogCloseBtn: $('dialogCloseBtn'),
  dialogCopyBtn: $('dialogCopyBtn'),
  dialogSaveBtn: $('dialogSaveBtn'),
  nleProofBtn: $('nleProofBtn'),
  nleDialog: $('nleDialog'),
  nleDialogCloseBtn: $('nleDialogCloseBtn'),
  nlePlayHighlightsBtn: $('nlePlayHighlightsBtn'),
  nleLoadSampleBtn: $('nleLoadSampleBtn'),
  nleOpenFolderBtn: $('nleOpenFolderBtn'),
  nleCopyStepsBtn: $('nleCopyStepsBtn'),
};

const app = {
  provider: null,
  mode: null,
  sessionActive: false,
  sessionCompleted: false,
  sessionStartMs: null,
  sessionEndMs: null,
  launching: false,
  stopping: false,
  killing: false,
  lastState: null,
  lastFrame: null,
  clips: [],
  clipsSignature: '',
  freshClipId: null,
  events: [],
  inspectorTab: 'telemetry',
  overlayBaseUrl: OVERLAY_FALLBACK,
  previewStream: null,
  faceless: true,
  numericOnly: false,
  hasKey: false,
  hasEnvKey: false,
  keyDirty: false,
  preflight: null,
  settingsTimer: null,
  clockTimer: null,
  exportFormat: 'edl',
  dialogText: '',
  clipPulseUntil: 0,
  obsWasConnected: false,
  obsKnown: false,
  simScopeRaf: null,
  stage: {
    mode: 'procedural',
    theme: 'unity',
    hasVideo: false,
    fileName: '',
    objectUrl: '',
    raf: null,
    boostUntil: 0,
  },
  align: {
    active: false,
    raf: null,
    endAt: 0,
  },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 0;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(num(seconds, 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function formatClipTime(seconds) {
  const total = Math.max(0, Math.floor(num(seconds, 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

function formatNumber(value, digits = 0) {
  return finite(value) ? value.toFixed(digits) : '--';
}

function formatDelta(value) {
  if (!finite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function setText(element, value) {
  if (!element) return;
  const next = value == null ? '' : String(value);
  if (element.textContent !== next) element.textContent = next;
}

function setWidth(element, percent) {
  if (!element) return;
  element.style.width = `${clamp(percent, 0, 100)}%`;
}

function setLeft(element, percent) {
  if (!element) return;
  element.style.left = `${clamp(percent, 0, 100)}%`;
}

function setScaleX(element, scale) {
  if (!element) return;
  element.style.transform = `scaleX(${clamp(scale, 0, 1)})`;
}

function on(element, type, handler, options) {
  if (element) element.addEventListener(type, handler, options);
}

function svgIcon(name, className) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${name}`);
  svg.appendChild(use);
  return svg;
}

function eventTime(t) {
  const date = new Date(finite(t) ? t : Date.now());
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

function dismissToast(node) {
  if (!node || !node.isConnected) return;
  node.classList.add('is-leaving');
  window.setTimeout(() => node.remove(), 240);
}

function toast({ kind = 'info', title = 'NOTICE', text = '', ttl = 5200 } = {}) {
  if (!dom.toastStack) return;
  while (dom.toastStack.children.length >= 4) {
    dom.toastStack.firstElementChild.remove();
  }

  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.kind = kind;

  const iconWrap = document.createElement('span');
  iconWrap.className = 'toast-icon';
  const iconName = kind === 'success' ? 'i-check' : kind === 'error' ? 'i-alert' : kind === 'sim' ? 'i-spark' : 'i-pulse';
  iconWrap.appendChild(svgIcon(iconName));

  const body = document.createElement('div');
  body.className = 'toast-body';
  const heading = document.createElement('b');
  heading.textContent = title;
  const copy = document.createElement('span');
  copy.textContent = text;
  body.append(heading, copy);

  node.append(iconWrap, body);
  dom.toastStack.appendChild(node);
  window.setTimeout(() => dismissToast(node), ttl);
}

async function copyText(text, message = 'Copied.') {
  try {
    await api.copyText(String(text));
    toast({ kind: 'success', title: 'COPIED', text: message, ttl: 2600 });
  } catch (err) {
    toast({ kind: 'error', title: 'CLIPBOARD ERROR', text: err && err.message ? err.message : 'Could not copy.' });
  }
}

// ---------------------------------------------------------------------------
// Gate: preflight, consent, key, launch
// ---------------------------------------------------------------------------

function setGateStatus(message, ok = false) {
  if (!dom.gateStatus) return;
  const text = message == null ? '' : String(message);
  dom.gateStatus.hidden = !text;
  dom.gateStatus.textContent = text;
  dom.gateStatus.classList.toggle('is-ok', !!ok);
}

function setServerStatus(status, error) {
  const label = status === 'listening' ? 'LISTENING' : status === 'error' ? 'ERROR' : 'STARTING';
  setText(dom.gateServerStatus, label);
  setText(dom.footerServerStatus, label);
  if (dom.gateServerPill) {
    dom.gateServerPill.classList.toggle('is-ok', status === 'listening');
    dom.gateServerPill.classList.toggle('is-error', status === 'error');
    dom.gateServerPill.title = error || `Overlay server ${label.toLowerCase()}`;
  }
}

function effectiveHasKey() {
  return app.hasKey || dom.apiKeyInput.value.trim().length > 0;
}

function updateKeyStatus() {
  const typed = dom.apiKeyInput.value.trim().length > 0;
  let label = 'NO KEY DETECTED';
  let ready = false;

  if (app.keyDirty && typed) {
    label = 'KEY READY · SAVES ON START';
    ready = true;
  } else if (app.hasEnvKey) {
    label = 'ENV KEY DETECTED';
    ready = true;
  } else if (app.hasKey) {
    label = 'RUNTIME KEY SET';
    ready = true;
  }

  setText(dom.keyStatus, label);
  if (dom.keyStatus) dom.keyStatus.classList.toggle('is-ready', ready);
  dom.apiKeyInput.placeholder = app.hasEnvKey
    ? 'ENV KEY LOADED · paste to override'
    : 'Paste key or load SMARTSPECTRA_API_KEY from .env';
}

function updateGate() {
  const consent = dom.consentCheck.checked;
  const keyReady = effectiveHasKey();

  dom.startLiveBtn.disabled = app.launching || !consent || !keyReady;
  dom.startSimBtn.disabled = app.launching;

  if (app.launching) {
    setText(dom.gateNote, 'Starting…');
  } else if (!consent) {
    setText(dom.gateNote, 'Consent required.');
  } else if (!keyReady) {
    setText(dom.gateNote, 'Key required for live.');
  } else {
    setText(dom.gateNote, 'Ready.');
  }
}

async function saveKey() {
  const value = dom.apiKeyInput.value.trim();
  try {
    const result = await api.setApiKey(value);
    app.hasKey = !!(result && result.hasKey);
    app.hasEnvKey = !!(result && result.hasEnvKey);
    app.keyDirty = false;
    updateKeyStatus();
    updateGate();
  } catch (err) {
    toast({ kind: 'error', title: 'KEY ERROR', text: err && err.message ? err.message : 'Could not store the key.' });
  }
}

async function loadPreflight() {
  try {
    const info = await api.preflight();
    app.preflight = info;
    app.overlayBaseUrl = info.overlayUrl || OVERLAY_FALLBACK;
    app.hasKey = info.hasKey === true;
    app.hasEnvKey = info.hasEnvKey === true;

    setText(dom.versionLabel, info.appVersion || '1.0.0');
    setText(dom.sdkLabel, info.sdkVersion || '—');
    setText(dom.electronLabel, info.electronVersion || '—');
    setText(dom.obsUrlLabel, info.obsUrl || 'ws://127.0.0.1:4455');
    if (info.obsPasswordSet) {
      dom.obsPasswordInput.placeholder = 'ENV PASSWORD DETECTED · optional override';
    }

    setServerStatus(info.serverStatus || 'starting', info.serverError);
    updateKeyStatus();
    updateGate();
    updateOverlayFrame();
  } catch (err) {
    setServerStatus('error', err && err.message ? err.message : String(err));
    setGateStatus(`Preflight failed: ${err && err.message ? err.message : err}`, false);
  }
}

function setGateBusy(busy) {
  dom.startLiveBtn.disabled = busy || !dom.consentCheck.checked || !effectiveHasKey();
  dom.startSimBtn.disabled = busy;
}

function buildLaunchOptions(mode) {
  return {
    mode,
    threshold: Number(dom.thresholdRange.value),
    sustainMs: Number(dom.sustainRange.value),
    cooldownMs: Number(dom.cooldownRange.value),
    expressionBoost: dom.expressionBoostCheck.checked,
    autoObs: dom.autoObsCheck.checked,
    facelessPreview: dom.previewFacelessCheck.checked,
  };
}

function syncSettingsUI(config) {
  if (!config || typeof config !== 'object') return;
  if (finite(config.threshold)) {
    dom.thresholdRange.value = String(config.threshold);
    setText(dom.thresholdOutput, String(Math.round(config.threshold)));
  }
  if (finite(config.sustainMs)) {
    dom.sustainRange.value = String(config.sustainMs);
    setText(dom.sustainOutput, `${(config.sustainMs / 1000).toFixed(1)}s`);
  }
  if (finite(config.cooldownMs)) {
    dom.cooldownRange.value = String(config.cooldownMs);
    setText(dom.cooldownOutput, `${Math.round(config.cooldownMs / 1000)}s`);
  }
  if (typeof config.expressionBoost === 'boolean') {
    dom.expressionBoostCheck.checked = config.expressionBoost;
    dom.expressionBoostStudio.checked = config.expressionBoost;
  }
}

async function launch(mode) {
  if (app.launching) return;
  app.launching = true;
  app.sessionCompleted = false;
  setGateBusy(true);
  setGateStatus('');

  let provider = null;
  try {
    if (mode === 'live') {
      if (!dom.consentCheck.checked) throw new Error('Camera consent is required before a live session.');
      if (dom.apiKeyInput.value.trim()) await saveKey();
      const keyResult = await api.setApiKey(dom.apiKeyInput.value.trim());
      app.hasKey = !!(keyResult && keyResult.hasKey);
      app.hasEnvKey = !!(keyResult && keyResult.hasEnvKey);
      if (!app.hasKey) throw new Error('No SmartSpectra API key. Add one to .env or paste it on this screen.');
      await api.setConsent(true);
    } else {
      await api.setConsent(false);
    }

    const result = await api.startSession(buildLaunchOptions(mode));
    if (!result || !result.mode) throw new Error('The session did not start.');

    app.mode = result.mode;
    app.sessionActive = true;
    app.sessionStartMs = Date.now();
    app.sessionEndMs = null;
    app.clips = [];
    app.clipsSignature = '';
    app.freshClipId = null;
    app.events = [];
    app.lastFrame = null;
    app.lastState = null;
    app.faceless = dom.previewFacelessCheck.checked;
    app.numericOnly = dom.numericOnlyCheck.checked;
    app.stage.boostUntil = 0;
    app.clipPulseUntil = 0;
    app.obsKnown = false;

    renderClips();
    renderEvents();
    syncSettingsUI(result.config);
    showStudio(result);

    provider = new SignalProvider({
      mode: result.mode,
      apiKey: result.apiKey || '',
      expressionBoost: dom.expressionBoostCheck.checked,
      onFrame: (frame) => {
        app.lastFrame = frame;
        api.sendFrame(frame);
      },
      onEvent: (event) => api.sendEvent(event),
      onPreviewStream: (stream) => attachPreviewStream(stream),
      onError: () => {
        // The main process echoes the same event and owns the error toast.
      },
    });
    app.provider = provider;

    await provider.start();

    toast({
      kind: result.mode === 'simulator' ? 'sim' : 'success',
      title: result.mode === 'simulator' ? 'SIMULATOR ARMED' : 'LIVE SESSION',
      text: result.mode === 'simulator'
        ? 'Simulator active.'
        : 'Live session active.',
    });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const active = provider || app.provider;
    app.provider = null;
    if (active) {
      try { await active.stop(); } catch { /* ignore */ }
    }
    try { await api.stopSession(); } catch { /* ignore */ }
    try { await api.setConsent(false); } catch { /* ignore */ }

    app.sessionActive = false;
    app.mode = null;
    app.sessionStartMs = null;
    app.sessionEndMs = null;
    dom.studioScreen.hidden = true;
    dom.gateScreen.hidden = false;
    stopSimScope();
    stopStageLoop();
    detachPreview();
    setGateStatus(message, false);
    toast({ kind: 'error', title: 'SESSION NOT STARTED', text: message });
  } finally {
    app.launching = false;
    setGateBusy(false);
    updateGate();
  }
}

// ---------------------------------------------------------------------------
// Screen lifecycle
// ---------------------------------------------------------------------------

function setCameraPill(state, label) {
  if (!dom.cameraPill) return;
  dom.cameraPill.dataset.state = state;
  setText(dom.cameraPillLabel, label);
}

function renderMode(state) {
  const active = state && state.mode && state.status !== 'idle';
  let mode = 'standby';
  if (active) mode = state.mode;
  else if (app.sessionCompleted) mode = 'complete';

  if (mode === 'live') {
    setText(dom.sessionModeChip, 'LIVE');
    dom.sessionModeChip.dataset.mode = 'live';
  } else if (mode === 'simulator') {
    setText(dom.sessionModeChip, 'SIMULATOR');
    dom.sessionModeChip.dataset.mode = 'simulator';
  } else if (mode === 'complete') {
    setText(dom.sessionModeChip, 'COMPLETE');
    delete dom.sessionModeChip.dataset.mode;
  } else {
    setText(dom.sessionModeChip, 'STANDBY');
    delete dom.sessionModeChip.dataset.mode;
  }

  const simActive = !!(state && state.mode === 'simulator' && state.status !== 'idle');
  dom.simHeaderBadge.hidden = !simActive;
  dom.simConsole.hidden = !simActive;
  dom.simSpikeBtn.disabled = !simActive;
  dom.simGaspBtn.disabled = !simActive;
  dom.simLeanBtn.disabled = !simActive;
  dom.simSkipBtn.disabled = !simActive;
  dom.simResetBtn.disabled = !simActive;
}

function statusLabel(state) {
  if (!state) return 'STANDBY';
  if (state.status === 'idle') return app.sessionCompleted ? 'COMPLETE' : 'STANDBY';
  if (state.status === 'starting') return 'STARTING';
  if (state.status === 'error') return 'ERROR';
  if (state.status === 'live') return state.baselineReady ? 'TRACKING' : 'WARM-UP';
  return String(state.status || 'STANDBY').toUpperCase();
}

function showStudio(result) {
  dom.gateScreen.hidden = true;
  dom.studioScreen.hidden = false;
  dom.sessionBanner.hidden = true;
  dom.overlaySlot.classList.toggle('is-hidden', !dom.overlayToggle.checked);
  dom.sessionStatusText.textContent = 'STARTING';
  dom.sessionClock.textContent = '00:00:00';
  dom.cameraFrameHint.textContent = '';
  dom.cameraFrameMode.textContent = app.mode === 'simulator' ? 'SIM' : 'LIVE';
  dom.signalSourceChip.textContent = app.mode === 'simulator' ? 'SIMULATOR' : 'LIVE CAMERA';
  dom.cameraFrameLabel.textContent = app.mode === 'simulator' ? 'SIMULATOR FEED' : 'CAMERA STARTING';
  dom.cameraFrameValidation.textContent = 'WAITING';
  dom.signalValidation.textContent = 'WAITING';
  dom.signalHint.textContent = app.mode === 'simulator'
    ? 'Synthetic signal active.'
    : 'Acquiring signal…';
  dom.numericOnlyCheck.checked = app.numericOnly;
  dom.alignHoldBtn.disabled = app.mode !== 'live';
  dom.stopSessionBtn.disabled = false;
  dom.killBtn.disabled = false;
  dom.detectorState.textContent = 'WARMING UP';
  dom.detectorState.dataset.state = 'warmup';
  dom.hypeScore.textContent = '0';
  dom.hypeBarFill.style.width = '0%';
  dom.hypeBarSustain.style.width = '0%';
  dom.baseBpm.textContent = '--';
  dom.baseStd.textContent = '--';
  dom.baseBreath.textContent = '--';
  dom.cooldownValue.textContent = '—';
  dom.timelineObsState.textContent = 'OBS OFFLINE';
  dom.obsActionText.textContent = 'Replay buffer + record chapter on each peak.';
  dom.inspectorUpdated.textContent = 'WAITING FOR DATA';
  dom.inspectorPackets.textContent = 'PKT 0';
  dom.inspectorJson.textContent = '{\n  "state": "waiting",\n  "hint": "Start a session to stream numeric frames"\n}';

  if (result && result.overlayUrl) {
    app.overlayBaseUrl = result.overlayUrl;
  }
  updateOverlayFrame();
  renderMode(null);
  applyPrivacy();
  startStageLoop();
  ensureSimScope();

  if (app.mode === 'simulator') {
    setCameraPill('sim', 'SIMULATOR');
  } else {
    setCameraPill('live', 'CAMERA LIVE');
  }
}

function showGate() {
  dom.gateScreen.hidden = false;
  dom.studioScreen.hidden = true;
  dom.sessionBanner.hidden = true;
  dom.simHeaderBadge.hidden = true;
  dom.simConsole.hidden = true;
  dom.sessionStatusText.textContent = 'STANDBY';
  dom.sessionClock.textContent = '00:00:00';
  dom.sessionModeChip.textContent = 'STANDBY';
  delete dom.sessionModeChip.dataset.mode;
  dom.consentCheck.checked = false;
  dom.cameraPill.dataset.state = 'idle';
  setText(dom.cameraPillLabel, 'CAMERA IDLE');
  dom.cameraFrameLabel.textContent = 'CAMERA IDLE';
  dom.cameraFrameValidation.textContent = 'WAITING';
  dom.cameraFrameHint.textContent = '';
  dom.cameraFrameMode.textContent = 'STANDBY';
  dom.signalSourceChip.textContent = 'STANDBY';
  dom.signalValidation.textContent = 'WAITING';
  dom.signalHint.textContent = 'Ready';
  dom.stopSessionBtn.disabled = true;
  dom.alignHoldBtn.disabled = true;
  dom.alignProgress.hidden = true;
  dom.numericCard.hidden = true;
  dom.facelessVeil.hidden = true;
  dom.simScope.hidden = true;
  dom.cameraPlaceholder.hidden = false;
  dom.detectorState.textContent = 'STANDBY';
  dom.detectorState.dataset.state = 'idle';
  dom.privacyState.textContent = 'PREVIEW OFF';
  dom.privacyState.classList.add('is-off');
  dom.sessionStartMs = null;
  dom.sessionEndMs = null;
  app.sessionStartMs = null;
  app.sessionEndMs = null;
  app.sessionActive = false;
  app.mode = null;
  endAlignHold();
  stopSimScope();
  stopStageLoop();
  detachPreview();
  if (dom.stageVideo) dom.stageVideo.pause();
  updateGate();
}

function showSessionBanner(clips) {
  const count = Array.isArray(clips) ? clips.length : 0;
  dom.sessionBanner.hidden = false;
  dom.sessionBannerTitle.textContent = count > 0
    ? `${count} clip${count === 1 ? '' : 's'} recorded.`
    : 'Session complete. 0 clips recorded.';
}

async function stopProvider() {
  const provider = app.provider;
  app.provider = null;
  if (!provider) return;
  try {
    await provider.stop();
  } catch {
    /* stop is best effort; buffers are cleared either way */
  }
}

async function stopSession() {
  if (app.stopping || !app.sessionActive) return;
  app.stopping = true;
  dom.stopSessionBtn.disabled = true;
  endAlignHold();
  detachPreview();

  try {
    await stopProvider();
    const result = await api.stopSession();
    if (result && Array.isArray(result.clips)) {
      app.clips = result.clips.slice();
      app.clipsSignature = '';
      renderClips();
    }
  } catch (err) {
    toast({ kind: 'error', title: 'STOP ERROR', text: err && err.message ? err.message : 'Session stop failed.' });
  }

  app.sessionActive = false;
  app.sessionCompleted = true;
  app.mode = null;
  app.sessionEndMs = Date.now();
  if (app.sessionStartMs) {
    dom.sessionClock.textContent = formatClock((app.sessionEndMs - app.sessionStartMs) / 1000);
  }

  setCameraPill('idle', 'CAMERA IDLE');
  dom.sessionStatusText.textContent = 'COMPLETE';
  dom.sessionModeChip.textContent = 'COMPLETE';
  delete dom.sessionModeChip.dataset.mode;
  dom.simConsole.hidden = true;
  dom.simHeaderBadge.hidden = true;
  dom.cameraFrameLabel.textContent = 'CAMERA IDLE';
  dom.cameraFrameValidation.textContent = 'WAITING';
  dom.cameraFrameHint.textContent = '';
  dom.cameraFrameMode.textContent = 'STANDBY';
  dom.signalSourceChip.textContent = 'STANDBY';
  dom.alignHoldBtn.disabled = true;
  dom.alignProgress.hidden = true;
  dom.stopSessionBtn.disabled = true;
  dom.detectorState.textContent = 'STANDBY';
  dom.detectorState.dataset.state = 'idle';
  dom.privacyState.textContent = 'PREVIEW OFF';
  dom.privacyState.classList.add('is-off');
  stopSimScope();
  applyPrivacy();
  showSessionBanner(app.clips);

  toast({
    kind: 'success',
    title: 'SESSION COMPLETE',
    text: app.clips.length > 0
      ? `${app.clips.length} clip${app.clips.length === 1 ? '' : 's'} ready to export.`
      : 'Session complete.',
  });

  app.stopping = false;
}

function applyKillState() {
  app.killing = false;
  app.sessionActive = false;
  app.sessionCompleted = false;
  app.mode = null;
  app.clips = [];
  app.clipsSignature = '';
  app.freshClipId = null;
  app.events = [];
  app.lastFrame = null;
  app.lastState = null;
  app.sessionStartMs = null;
  app.sessionEndMs = null;

  endAlignHold();
  detachPreview();
  stopSimScope();
  stopStageLoop();
  renderClips();
  renderEvents();

  dom.sessionBanner.hidden = true;
  dom.studioScreen.hidden = true;
  dom.gateScreen.hidden = false;
  dom.consentCheck.checked = false;
  dom.gateStatus.hidden = true;
  dom.cameraPill.dataset.state = 'idle';
  setText(dom.cameraPillLabel, 'CAMERA IDLE');
  dom.sessionClock.textContent = '00:00:00';
  dom.sessionStatusText.textContent = 'STANDBY';
  dom.sessionModeChip.textContent = 'STANDBY';
  delete dom.sessionModeChip.dataset.mode;
  dom.detectorState.textContent = 'STANDBY';
  dom.detectorState.dataset.state = 'idle';
  dom.privacyState.textContent = 'PREVIEW OFF';
  dom.privacyState.classList.add('is-off');
  dom.cameraFrameLabel.textContent = 'CAMERA IDLE';
  dom.cameraFrameValidation.textContent = 'WAITING';
  dom.cameraFrameHint.textContent = '';
  dom.cameraFrameMode.textContent = 'STANDBY';
  dom.signalSourceChip.textContent = 'STANDBY';
  dom.signalValidation.textContent = 'WAITING';
  dom.signalHint.textContent = 'Ready';
  dom.alignHoldBtn.disabled = true;
  dom.alignProgress.hidden = true;
  dom.stopSessionBtn.disabled = true;
  dom.simConsole.hidden = true;
  dom.simHeaderBadge.hidden = true;
  dom.numericCard.hidden = true;
  dom.facelessVeil.hidden = true;
  dom.simScope.hidden = true;
  dom.cameraPlaceholder.hidden = false;
  if (dom.stageVideo) dom.stageVideo.pause();
  updateGate();
}

function handleKill() {
  try { api.ackKill(); } catch { /* ignore */ }
  void stopProvider();
  applyKillState();
  toast({
    kind: 'error',
    title: 'CAMERA STOPPED',
    text: 'Camera stopped and buffers cleared.',
  });
}

async function engageKill() {
  if (app.killing) return;
  app.killing = true;
  endAlignHold();
  detachPreview();
  void stopProvider();
  try {
    await api.killCamera();
  } catch (err) {
    applyKillState();
    toast({
      kind: 'error',
      title: 'KILL ERROR',
      text: err && err.message ? err.message : 'The camera could not be stopped through the main process.',
    });
  }
}

function newSession() {
  app.clips = [];
  app.clipsSignature = '';
  app.freshClipId = null;
  app.events = [];
  app.lastFrame = null;
  app.lastState = null;
  app.sessionCompleted = false;
  app.sessionStartMs = null;
  app.sessionEndMs = null;
  app.sessionActive = false;
  renderClips();
  renderEvents();
  showGate();
  dom.gateStatus.hidden = true;
  dom.consentCheck.checked = false;
  updateGate();
  updateKeyStatus();
}

// ---------------------------------------------------------------------------
// State → studio
// ---------------------------------------------------------------------------

function handleState(state) {
  if (!state || typeof state !== 'object') return;
  app.lastState = state;

  if (finite(state.sessionStartMs)) app.sessionStartMs = state.sessionStartMs;
  if (finite(state.sessionEndMs)) app.sessionEndMs = state.sessionEndMs;

  renderServer(state);
  renderTelemetry(state);
  renderHype(state);
  renderObs(state);
  renderMode(state);

  if (Array.isArray(state.clips)) setClips(state.clips);

  if (finite(state.elapsedSec) && (app.sessionActive || app.sessionCompleted)) {
    dom.sessionClock.textContent = formatClock(state.elapsedSec);
  }

  dom.inspectorLiveDot.style.opacity = state.status === 'idle' ? '0.25' : '1';
  renderInspector();
}

function defaultSignalHint(state) {
  if (!state || state.status === 'idle') return 'Ready';
  if (state.mode === 'simulator') return 'Synthetic signal active.';
  if (state.status === 'starting') return 'Connecting camera…';
  if (!state.baselineReady) return 'Warming up baseline…';
  return 'Signal active.';
}

function renderTelemetry(state) {
  const active = !!(state && state.mode && state.status !== 'idle');
  const bpm = active ? state.bpm : null;
  const breath = active ? state.breathRate : null;
  const confidence = active && finite(state.confidence) ? clamp01(state.confidence) : null;
  const delta = finite(bpm) && finite(state.baselineBpm) ? bpm - state.baselineBpm : null;
  const validation = active ? (state.validationState || 'WAITING') : 'WAITING';
  const hint = active ? (state.validationHint || defaultSignalHint(state)) : 'Ready';

  setText(dom.signalBpm, formatNumber(bpm, 0));
  setText(dom.signalDelta, formatDelta(delta));
  setText(dom.signalBreath, formatNumber(breath, 0));
  setText(dom.signalConf, confidence == null ? '--' : String(Math.round(confidence * 100)));
  setText(dom.signalValidation, validation);
  setText(dom.signalHint, hint);

  setText(dom.numericBpm, formatNumber(bpm, 0));
  setText(dom.numericDelta, formatDelta(delta));
  setText(dom.numericBreath, formatNumber(breath, 0));
  setText(dom.numericValidation, validation);
  setText(dom.numericConfidence, confidence == null ? 'CONF --' : `CONF ${Math.round(confidence * 100)}%`);

  setText(dom.cameraFrameValidation, validation);
  setText(dom.cameraFrameHint, '');

  const mode = active ? state.mode : null;
  if (mode === 'live') {
    const error = state.status === 'error';
    setText(dom.cameraFrameLabel, error ? 'CAMERA ERROR' : state.status === 'starting' ? 'CAMERA STARTING' : 'CAMERA LIVE');
    setText(dom.cameraFrameMode, 'LIVE');
    setText(dom.signalSourceChip, state.status === 'starting' ? 'CAMERA STARTING' : 'LIVE CAMERA');
    setCameraPill('live', error ? 'CAMERA ERROR' : 'CAMERA LIVE');
  } else if (mode === 'simulator') {
    setText(dom.cameraFrameLabel, 'SIMULATOR FEED');
    setText(dom.cameraFrameMode, 'SIM');
    setText(dom.signalSourceChip, 'SIMULATOR');
    setCameraPill('sim', 'SIMULATOR');
  } else {
    setText(dom.cameraFrameLabel, 'CAMERA IDLE');
    setText(dom.cameraFrameMode, 'STANDBY');
    setText(dom.signalSourceChip, 'STANDBY');
    setCameraPill('idle', 'CAMERA IDLE');
  }

  const live = mode === 'live';
  const sim = mode === 'simulator';
  if (dom.gateCameraPill) {
    dom.gateCameraPill.classList.toggle('is-live', live);
    dom.gateCameraPill.classList.toggle('is-sim', sim);
    dom.gateCameraPill.classList.toggle('is-error', active && state.status === 'error');
  }
  setText(dom.gateCameraStatus, live ? 'CAMERA LIVE' : sim ? 'SIMULATOR' : 'CAMERA IDLE');

  setText(dom.sessionStatusText, statusLabel(state));
}

function renderHype(state) {
  const active = !!(state && state.mode && state.status !== 'idle');
  const threshold = finite(state && state.threshold)
    ? state.threshold
    : Number(dom.thresholdRange.value) || 70;
  const sustainMs = finite(state && state.sustainMs)
    ? state.sustainMs
    : Number(dom.sustainRange.value) || 2500;
  const score = active ? clamp(num(state.hypeScore), 0, 100) : 0;
  const components = (state && state.components) || {};

  let phase = 'idle';
  if (active) {
    if (Date.now() < app.clipPulseUntil) phase = 'clip';
    else if (!state.baselineReady) phase = 'warmup';
    else if (num(state.cooldownRemaining) > 0) phase = 'cooldown';
    else if (num(state.sustainedMs) > 0) phase = 'building';
    else phase = 'ready';
  }

  const labels = {
    idle: 'STANDBY',
    warmup: 'WARMING UP',
    ready: 'READY',
    building: 'BUILDING',
    cooldown: 'COOLDOWN',
    clip: 'PEAK CAPTURED',
  };
  dom.detectorState.dataset.state = phase;
  setText(dom.detectorState, labels[phase]);

  setText(dom.hypeScore, String(Math.round(score)));
  setWidth(dom.hypeBarFill, score);
  dom.hypeBarFill.classList.toggle('is-hot', score >= threshold);
  setLeft(dom.hypeBarThreshold, threshold);
  setText(dom.hypeThresholdValue, String(Math.round(threshold)));
  setText(dom.hypeSustainValue, `${(sustainMs / 1000).toFixed(1)}s`);

  const sustained = active ? num(state.sustainedMs) : 0;
  setWidth(dom.hypeBarSustain, phase === 'clip' ? 100 : sustainMs > 0 ? (sustained / sustainMs) * 100 : 0);

  let statusLine = 'Detector idle';
  if (phase === 'warmup') statusLine = 'Baseline warming up';
  else if (phase === 'ready') statusLine = 'Baseline locked · watching for peaks';
  else if (phase === 'building') statusLine = 'Sustained hype above threshold';
  else if (phase === 'cooldown') statusLine = 'Cooldown hold after last peak';
  else if (phase === 'clip') statusLine = 'Peak moment captured';
  setText(dom.hypeStatusLine, statusLine);

  let countdown = '—';
  if (phase === 'warmup') countdown = `${Math.ceil(num(state.warmupRemaining) / 1000)}s`;
  else if (phase === 'cooldown') countdown = `${Math.ceil(num(state.cooldownRemaining) / 1000)}s`;
  else if (active) countdown = 'LIVE';
  setText(dom.hypeCountdown, countdown);

  setText(dom.baseBpm, formatNumber(state && state.baselineBpm, 1));
  setText(dom.baseStd, formatNumber(state && state.baselineStd, 2));
  setText(dom.baseBreath, formatNumber(state && state.baselineBreathRate, 1));
  const cooldown = active ? num(state.cooldownRemaining) : 0;
  setText(dom.cooldownValue, cooldown > 0 ? `${Math.ceil(cooldown / 1000)}s` : '—');

  setText(dom.compDelta, formatNumber(components.pulseDelta, 1));
  setWidth(dom.compDeltaBar, (num(components.deltaScore) / 62) * 100);
  setText(dom.compSlope, formatNumber(components.pulseSlope, 1));
  setWidth(dom.compSlopeBar, (num(components.slopeScore) / 18) * 100);
  setText(dom.compBreath, formatNumber(components.breathDeviation, 1));
  setWidth(dom.compBreathBar, (num(components.breathScore) / 12) * 100);
  setText(dom.compIrr, formatNumber(components.breathIrregularity, 1));
  setWidth(dom.compIrrBar, (num(components.irregularityScore) / 8) * 100);
  setText(dom.compExpr, String(Math.round(num(components.expressionBoost))));
  setWidth(dom.compExprBar, (num(components.expressionScore) / 12) * 100);
}

function renderObs(state) {
  const obs = (state && state.obs) || {};
  const status = obs.status || 'offline';
  const online = obs.connected === true;
  const label = status === 'connected'
    ? 'ONLINE'
    : status === 'connecting'
      ? 'CONNECTING'
      : status === 'error'
        ? 'ERROR'
        : status === 'disconnected'
          ? 'OFFLINE'
          : 'OFFLINE';

  setText(dom.obsChipText, label);
  dom.obsChip.classList.toggle('is-live', online);
  dom.obsChip.classList.toggle('is-error', status === 'error');

  setText(dom.obsStateChip, label);
  dom.obsStateChip.dataset.state = online
    ? 'ready'
    : status === 'error'
      ? 'cooldown'
      : status === 'connecting'
        ? 'warmup'
        : 'idle';

  dom.obsDisconnectBtn.disabled = !online;
  setText(dom.obsConnectBtn, online ? 'RECONNECT' : 'CONNECT');

  if (online) {
    const replay = obs.replayActive === true ? 'armed' : obs.replayActive === false ? 'idle' : 'unknown';
    const record = obs.recordActive === true ? 'active' : obs.recordActive === false ? 'idle' : 'unknown';
    setText(dom.obsActionText, `Replay: ${replay} · Record: ${record}`);
    setText(dom.timelineObsState, 'OBS ONLINE');
  } else {
    setText(dom.obsActionText, 'Arm replay buffer & chapters');
    setText(
      dom.timelineObsState,
      status === 'connecting' ? 'OBS CONNECTING' : status === 'error' ? 'OBS ERROR' : 'OBS OFFLINE',
    );
  }

  if (app.obsKnown) {
    if (online && !app.obsWasConnected) {
      toast({ kind: 'success', title: 'OBS CONNECTED', text: 'OBS connected.' });
    } else if (!online && app.obsWasConnected) {
      toast({ kind: 'info', title: 'OBS OFFLINE', text: 'OBS offline.' });
    }
  }
  app.obsKnown = true;
  app.obsWasConnected = online;
}

function renderServer(state) {
  const server = (state && state.server) || {
    status: 'starting',
    error: null,
    url: app.overlayBaseUrl,
    clients: 0,
  };
  setServerStatus(server.status || 'starting', server.error);

  const clients = Math.max(0, Math.floor(num(server.clients)));
  setText(dom.hudClients, String(clients));
  setText(dom.footerClients, String(clients));

  const packets = Math.max(0, Math.floor(num(state && state.packetCount)));
  const fps = num(state && state.fps);
  setText(dom.footerPackets, String(packets));
  setText(dom.footerFps, fps.toFixed(1));

  if (server.url && server.url !== app.overlayBaseUrl) {
    app.overlayBaseUrl = server.url;
    updateOverlayFrame();
  }
  setText(dom.footerOverlayUrl, app.overlayBaseUrl);
}

// ---------------------------------------------------------------------------
// Clip timeline
// ---------------------------------------------------------------------------

function setClips(clips) {
  const next = Array.isArray(clips) ? clips.slice() : [];
  const signature = next
    .map((clip) => {
      const obs = clip && clip.obs ? `${clip.obs.replay || ''}/${clip.obs.chapter || ''}` : '';
      return `${clip && clip.id}|${clip && clip.peakBpm}|${obs}`;
    })
    .join('~');

  if (signature === app.clipsSignature && !app.freshClipId) return;
  app.clips = next;
  app.clipsSignature = signature;
  renderClips();
}

function miniChip(text, variant) {
  const chip = document.createElement('span');
  chip.className = variant ? `mini-chip ${variant}` : 'mini-chip';
  chip.textContent = text;
  return chip;
}

function createClipRow(clip, index) {
  const row = document.createElement('div');
  row.className = 'clip-row';
  row.dataset.clipId = clip.id || `clip-${index}`;
  if (clip.id && clip.id === app.freshClipId) row.classList.add('is-fresh');

  const indexWrap = document.createElement('div');
  indexWrap.className = 'clip-index';
  const indexNumber = document.createElement('b');
  indexNumber.textContent = pad2(Math.max(1, Math.floor(num(clip.index, index + 1))));
  const indexLabel = document.createElement('span');
  indexLabel.textContent = 'PEAK';
  indexWrap.append(indexNumber, indexLabel);

  const body = document.createElement('div');
  body.className = 'clip-body';

  const topline = document.createElement('div');
  topline.className = 'clip-topline';
  const peak = document.createElement('span');
  peak.className = 'clip-peak';
  peak.textContent = formatNumber(num(clip.peakBpm), 0);
  const peakUnit = document.createElement('small');
  peakUnit.textContent = 'BPM';
  peak.appendChild(peakUnit);
  const time = document.createElement('span');
  time.className = 'clip-time';
  time.textContent = `${formatClipTime(clip.startSec)} → ${formatClipTime(clip.endSec)}`;
  topline.append(peak, time);

  const delta = finite(clip.deltaBpm) ? clip.deltaBpm : null;
  if (delta != null) {
    const chip = document.createElement('span');
    chip.className = 'mini-chip';
    chip.textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} Δ`;
    topline.appendChild(chip);
  }

  const reason = document.createElement('div');
  reason.className = 'clip-reason';
  reason.textContent = clip.reason || 'Sustained hype';
  reason.title = reason.textContent;

  const meta = document.createElement('div');
  meta.className = 'clip-meta';
  meta.appendChild(miniChip(`HYPE ${Math.round(num(clip.hypeScore))}`, 'mini-chip--ok'));

  if (finite(clip.confidence)) {
    meta.appendChild(miniChip(`CONF ${Math.round(clamp01(clip.confidence) * 100)}%`));
  }

  const obs = clip.obs;
  if (obs && obs.replay === 'saved') {
    meta.appendChild(miniChip('OBS SAVED', 'mini-chip--ok'));
  } else if (obs && typeof obs.replay === 'string' && obs.replay.startsWith('failed')) {
    meta.appendChild(miniChip('OBS FAILED', 'mini-chip--hot'));
  } else if (obs && obs.replay === 'OBS offline') {
    meta.appendChild(miniChip('OBS OFFLINE', 'mini-chip--muted'));
  } else if (obs && obs.attempted) {
    meta.appendChild(miniChip('OBS PARTIAL', 'mini-chip--warn'));
  } else {
    meta.appendChild(miniChip('OBS —', 'mini-chip--muted'));
  }

  const windowSec = Math.max(0, num(clip.endSec) - num(clip.startSec));
  meta.appendChild(miniChip(`WIN ${Math.round(windowSec)}s`, 'mini-chip--muted'));

  body.append(topline, reason, meta);

  const actions = document.createElement('div');
  actions.className = 'clip-actions';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'icon-btn icon-btn--sm';
  copyButton.title = 'Copy clip summary';
  copyButton.setAttribute('aria-label', `Copy summary for peak moment ${indexNumber.textContent}`);
  copyButton.appendChild(svgIcon('i-copy'));
  copyButton.addEventListener('click', () => {
    const summary = [
      `Peak Moment ${indexNumber.textContent}`,
      `${delta == null ? '--' : formatDelta(delta)} BPM`,
      `${formatClipTime(clip.startSec)}–${formatClipTime(clip.endSec)}`,
      clip.reason || 'Sustained hype',
    ].join(' · ');
    void copyText(summary, 'Clip summary copied.');
  });
  actions.appendChild(copyButton);

  row.append(indexWrap, body, actions);
  return row;
}

function renderClips() {
  const clips = app.clips
    .slice()
    .sort((a, b) => num(b.index) - num(a.index));

  setText(dom.clipCount, String(clips.length));
  dom.timelineEmpty.hidden = clips.length > 0;
  dom.timelineList.hidden = clips.length === 0;
  dom.timelineList.replaceChildren(...clips.map((clip, i) => createClipRow(clip, i)));
}

function handleClip(clip) {
  if (!clip || typeof clip !== 'object') return;
  const exists = clip.id && app.clips.some((item) => item.id === clip.id);
  if (!exists) app.clips.push(clip);
  app.clipsSignature = '';
  app.freshClipId = clip.id || null;
  app.clipPulseUntil = Date.now() + 1800;
  renderClips();
  renderHype(app.lastState);

  if (app.freshClipId) {
    const fresh = app.freshClipId;
    window.setTimeout(() => {
      if (app.freshClipId !== fresh) return;
      app.freshClipId = null;
      const row = dom.timelineList.querySelector(`[data-clip-id="${fresh}"]`);
      if (row) row.classList.remove('is-fresh');
    }, 3000);
  }

  app.stage.boostUntil = Date.now() + 1600;
  dom.stageFlash.classList.remove('is-flashing');
  void dom.stageFlash.offsetWidth;
  dom.stageFlash.classList.add('is-flashing');

  const peak = formatNumber(num(clip.peakBpm), 0);
  toast({
    kind: 'success',
    title: 'PEAK CLIPPED',
    text: `Peak ${peak} BPM · [−${num(clip.preRollSec, 20)}s / +${num(clip.postRollSec, 10)}s]`,
    ttl: 4000,
  });
}

// ---------------------------------------------------------------------------
// Events + inspector
// ---------------------------------------------------------------------------

function renderEvents() {
  const events = app.events.slice(-200).reverse();
  setText(dom.eventCount, String(app.events.length));
  dom.eventEmpty.hidden = events.length > 0;
  dom.eventList.hidden = events.length === 0;

  const rows = events.map((event) => {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.dataset.kind = event.kind || 'event';

    const time = document.createElement('time');
    time.textContent = eventTime(event.t);

    const kind = document.createElement('span');
    kind.className = 'event-kind';
    kind.textContent = event.kind || 'event';

    const text = document.createElement('span');
    text.className = 'event-text';
    text.textContent = event.text || '';
    text.title = event.text || '';

    row.append(time, kind, text);
    return row;
  });

  dom.eventList.replaceChildren(...rows);
}

function handleEvent(event) {
  if (!event || typeof event !== 'object') return;
  app.events.push(event);
  if (app.events.length > 200) app.events.shift();
  renderEvents();
}

function handleToast(payload) {
  if (!payload || typeof payload !== 'object') return;
  const kind = payload.kind === 'error' ? 'error' : payload.kind === 'success' ? 'success' : 'info';
  toast({
    kind,
    title: kind === 'error' ? 'SIGNAL ERROR' : kind === 'success' ? 'NOTICE' : 'NOTICE',
    text: payload.text || '',
  });
}

function renderInspector() {
  if (!dom.inspectorPanel || dom.inspectorPanel.classList.contains('is-collapsed')) return;
  if (app.inspectorTab !== 'telemetry') return;
  if (!app.lastState && !app.lastFrame) return;

  const now = Date.now();
  if (now - num(app.inspectorLastRender) < 160) return;
  app.inspectorLastRender = now;

  const state = app.lastState;
  const frame = app.lastFrame;
  const delta = state && finite(state.bpm) && finite(state.baselineBpm)
    ? state.bpm - state.baselineBpm
    : null;

  const payload = {
    frame: frame
      ? {
        at: eventTime(frame.t),
        bpm: frame.bpm,
        breathRate: frame.breathRate,
        confidence: frame.confidence,
        stable: frame.stable,
        validation: {
          code: frame.validationCode,
          state: frame.validationState,
          hint: frame.validationHint,
        },
        expression: frame.expression,
      }
      : null,
    detector: state
      ? {
        score: state.hypeScore,
        threshold: state.threshold,
        baselineBpm: state.baselineBpm,
        baselineStd: state.baselineStd,
        baselineBreathRate: state.baselineBreathRate,
        baselineReady: state.baselineReady,
        warmupRemaining: state.warmupRemaining,
        cooldownRemaining: state.cooldownRemaining,
        sustainedMs: state.sustainedMs,
        components: state.components,
      }
      : null,
    session: state
      ? {
        mode: state.mode,
        status: state.status,
        elapsedSec: state.elapsedSec,
        deltaBpm: delta,
        clips: state.clips ? state.clips.length : 0,
      }
      : null,
    link: state
      ? {
        overlayClients: state.server ? state.server.clients : 0,
        obsConnected: state.obs ? state.obs.connected : false,
        packets: state.packetCount,
        fps: state.fps,
      }
      : null,
  };

  const scrollTop = dom.inspectorJson.scrollTop;
  try {
    dom.inspectorJson.textContent = JSON.stringify(payload, null, 2);
  } catch {
    dom.inspectorJson.textContent = '{\n  "state": "unserializable"\n}';
  }
  dom.inspectorJson.scrollTop = scrollTop;
  setText(dom.inspectorUpdated, `UPDATED ${eventTime(now)}`);
  setText(dom.inspectorPackets, `PKT ${Math.max(0, Math.floor(num(state && state.packetCount)))}`);
}

// ---------------------------------------------------------------------------
// Camera preview + privacy hold
// ---------------------------------------------------------------------------

function attachPreviewStream(stream) {
  if (!stream) {
    detachPreview();
    return;
  }

  app.previewStream = stream;
  dom.previewVideo.srcObject = stream;
  dom.previewVideo.hidden = false;
  const played = dom.previewVideo.play();
  if (played && typeof played.catch === 'function') played.catch(() => {});
  dom.cameraPlaceholder.hidden = true;
  applyPrivacy();
}

function detachPreview() {
  if (app.previewStream) {
    try {
      for (const track of app.previewStream.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  app.previewStream = null;
  if (dom.previewVideo) {
    try { dom.previewVideo.pause(); } catch { /* ignore */ }
    dom.previewVideo.srcObject = null;
    dom.previewVideo.hidden = true;
  }
  applyPrivacy();
}

function applyPrivacy() {
  const active = app.sessionActive;
  const live = active && app.mode === 'live';
  const sim = active && app.mode === 'simulator';
  const hasStream = !!app.previewStream;
  const holding = app.align.active;
  const showVideo = live && hasStream && !app.numericOnly;

  if (dom.previewVideo) dom.previewVideo.hidden = !showVideo;
  if (dom.facelessVeil) {
    dom.facelessVeil.hidden = !(showVideo && app.faceless && !holding);
  }
  if (dom.cameraFrame) {
    dom.cameraFrame.classList.toggle('is-unblurred', showVideo && (holding || !app.faceless));
    dom.cameraFrame.dataset.mode = sim ? 'sim' : live ? 'live' : 'idle';
  }
  if (dom.numericCard) dom.numericCard.hidden = !(active && app.numericOnly);
  if (dom.simScope) dom.simScope.hidden = !(sim && !app.numericOnly);
  if (dom.cameraPlaceholder) {
    dom.cameraPlaceholder.hidden = showVideo || (active && app.numericOnly) || sim;
  }
  if (dom.alignHoldBtn) {
    dom.alignHoldBtn.disabled = !(live && hasStream) || app.numericOnly;
  }

  let label = 'PREVIEW OFF';
  let off = true;
  if (!active) {
    label = 'PREVIEW OFF';
    off = true;
  } else if (app.numericOnly) {
    label = 'NUMERIC ONLY';
    off = true;
  } else if (sim) {
    label = 'SIMULATOR';
    off = true;
  } else if (!hasStream) {
    label = 'WAITING';
    off = true;
  } else if (holding) {
    label = 'ALIGNING';
    off = false;
  } else if (app.faceless) {
    label = 'FACELESS';
    off = false;
  } else {
    label = 'ACTIVE';
    off = false;
  }

  setText(dom.privacyState, label);
  if (dom.privacyState) dom.privacyState.classList.toggle('is-off', off);
}

function startAlignHold() {
  if (!app.sessionActive || app.mode !== 'live' || !app.previewStream || app.numericOnly) return;
  if (app.align.active) return;

  app.align.active = true;
  app.align.endAt = performance.now() + BLUR_SECONDS * 1000;
  dom.alignHoldBtn.classList.add('is-holding');
  dom.alignProgress.hidden = false;
  setScaleX(dom.alignFill, 1);
  setText(dom.alignCount, BLUR_SECONDS.toFixed(1));
  applyPrivacy();

  const tick = () => {
    if (!app.align.active) return;
    const remaining = app.align.endAt - performance.now();
    if (remaining <= 0) {
      endAlignHold();
      return;
    }
    setScaleX(dom.alignFill, remaining / (BLUR_SECONDS * 1000));
    setText(dom.alignCount, (remaining / 1000).toFixed(1));
    app.align.raf = window.requestAnimationFrame(tick);
  };
  app.align.raf = window.requestAnimationFrame(tick);
}

function endAlignHold() {
  if (app.align.raf) {
    window.cancelAnimationFrame(app.align.raf);
    app.align.raf = null;
  }
  if (!app.align.active) {
    dom.alignProgress.hidden = true;
    return;
  }
  app.align.active = false;
  dom.alignHoldBtn.classList.remove('is-holding');
  dom.alignProgress.hidden = true;
  setScaleX(dom.alignFill, 1);
  setText(dom.alignCount, BLUR_SECONDS.toFixed(1));
  applyPrivacy();
}

// ---------------------------------------------------------------------------
// Simulator scope
// ---------------------------------------------------------------------------

function ensureSimScope() {
  if (!(app.sessionActive && app.mode === 'simulator')) {
    stopSimScope();
    return;
  }
  if (app.simScopeRaf) return;

  const ctx = dom.simScope.getContext('2d');
  const loop = () => {
    if (!(app.sessionActive && app.mode === 'simulator')) {
      app.simScopeRaf = null;
      return;
    }
    if (!dom.simScope.hidden) drawSimScope(ctx);
    app.simScopeRaf = window.requestAnimationFrame(loop);
  };
  app.simScopeRaf = window.requestAnimationFrame(loop);
}

function stopSimScope() {
  if (app.simScopeRaf) {
    window.cancelAnimationFrame(app.simScopeRaf);
    app.simScopeRaf = null;
  }
  if (!dom.simScope) return;
  const ctx = dom.simScope.getContext('2d');
  ctx.clearRect(0, 0, dom.simScope.width, dom.simScope.height);
}

function drawSimScope(ctx) {
  const W = dom.simScope.width;
  const H = dom.simScope.height;
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.strokeStyle = 'rgba(136, 164, 201, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }

  const trace = (app.lastFrame && app.lastFrame.pulseTrace) || [];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(67, 232, 255, 0.92)';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(67, 232, 255, 0.6)';
  ctx.shadowBlur = 10;
  ctx.beginPath();

  if (trace.length > 1) {
    for (let i = 0; i < trace.length; i += 1) {
      const x = (i / (trace.length - 1)) * W;
      const y = H * 0.72 - clamp01(trace[i]) * H * 0.42;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  } else {
    ctx.moveTo(0, H * 0.58);
    ctx.lineTo(W, H * 0.58);
  }
  ctx.stroke();

  const sweep = ((performance.now() / 2600) % 1) * W;
  const gradient = ctx.createLinearGradient(sweep - 30, 0, sweep + 30, 0);
  gradient.addColorStop(0, 'rgba(67, 232, 255, 0)');
  gradient.addColorStop(0.5, 'rgba(67, 232, 255, 0.12)');
  gradient.addColorStop(1, 'rgba(67, 232, 255, 0)');
  ctx.shadowBlur = 0;
  ctx.fillStyle = gradient;
  ctx.fillRect(sweep - 30, 0, 60, H);

  ctx.font = '600 10px "Cascadia Mono", Consolas, monospace';
  ctx.fillStyle = 'rgba(196, 255, 69, 0.72)';
  ctx.textAlign = 'left';
  ctx.fillText('SYNTHETIC SIGNAL', 14, 22);
  ctx.fillStyle = 'rgba(169, 139, 255, 0.85)';
  ctx.textAlign = 'right';
  ctx.fillText('NO LIVE CAMERA', W - 14, 22);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Procedural stage
// ---------------------------------------------------------------------------

function startStageLoop() {
  if (app.stage.raf) return;
  const ctx = dom.gameCanvas.getContext('2d');
  const tick = (now) => {
    app.stage.raf = window.requestAnimationFrame(tick);
    if (document.hidden || dom.gameCanvas.hidden) return;
    drawStage(ctx, now);
  };
  app.stage.raf = window.requestAnimationFrame(tick);
}

function stopStageLoop() {
  if (app.stage.raf) {
    window.cancelAnimationFrame(app.stage.raf);
    app.stage.raf = null;
  }
}

function drawMountains(ctx, baseY, color, amplitude, phase, shift) {
  const W = 1280;
  const H = 720;
  ctx.beginPath();
  ctx.moveTo(0, baseY + 20);
  for (let x = 0; x <= W; x += 20) {
    const n = Math.sin((x + shift) * 0.006 + phase) * 0.55
      + Math.sin((x + shift) * 0.013 + phase * 1.7) * 0.3
      + Math.sin((x + shift) * 0.027 + phase) * 0.15;
    const y = baseY - (0.35 + Math.abs(n)) * amplitude;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, baseY + 20);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawCar(ctx, x, y, boost, t) {
  const glow = ctx.createRadialGradient(x, y + 34, 4, x, y + 34, 128);
  glow.addColorStop(0, boost ? 'rgba(255, 220, 120, 0.52)' : 'rgba(67, 232, 255, 0.42)');
  glow.addColorStop(1, 'rgba(67, 232, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 140, y - 46, 280, 150);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.ellipse(x, y + 30, 88, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createLinearGradient(0, y - 34, 0, y + 28);
  body.addColorStop(0, '#1d2946');
  body.addColorStop(0.55, '#0b1020');
  body.addColorStop(1, '#05070d');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - 78, y + 22);
  ctx.lineTo(x - 52, y - 18);
  ctx.lineTo(x - 18, y - 30);
  ctx.lineTo(x + 18, y - 30);
  ctx.lineTo(x + 52, y - 18);
  ctx.lineTo(x + 78, y + 22);
  ctx.closePath();
  ctx.fill();

  const glass = ctx.createLinearGradient(0, y - 26, 0, y + 2);
  glass.addColorStop(0, 'rgba(67, 232, 255, 0.44)');
  glass.addColorStop(1, 'rgba(67, 232, 255, 0.04)');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.moveTo(x - 30, y - 18);
  ctx.lineTo(x - 14, y - 26);
  ctx.lineTo(x + 14, y - 26);
  ctx.lineTo(x + 30, y - 18);
  ctx.lineTo(x + 22, y - 2);
  ctx.lineTo(x - 22, y - 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#070a12';
  ctx.fillRect(x - 44, y - 35, 88, 5);
  ctx.fillRect(x - 36, y - 35, 4, 11);
  ctx.fillRect(x + 32, y - 35, 4, 11);

  ctx.shadowColor = boost ? 'rgba(255, 220, 120, 0.9)' : 'rgba(255, 59, 107, 0.9)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = boost ? '#ffe08a' : '#ff3b6b';
  ctx.fillRect(x - 64, y + 8, 26, 5);
  ctx.fillRect(x + 38, y + 8, 26, 5);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#03040a';
  ctx.fillRect(x - 62, y + 20, 22, 8);
  ctx.fillRect(x + 40, y + 20, 22, 8);

  ctx.strokeStyle = boost ? 'rgba(255, 220, 120, 0.5)' : 'rgba(67, 232, 255, 0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i += 1) {
    const offset = (t * 120 + i * 17) % 40;
    ctx.beginPath();
    ctx.moveTo(x - 50 + i * 50, y + 28);
    ctx.lineTo(x - 50 + i * 50, y + 38 + offset);
    ctx.stroke();
  }
}

function drawStage(ctx, now) {
  const W = 1280;
  const H = 720;
  const t = now / 1000;
  const horizon = H * 0.56;
  const vpX = W / 2;
  const boost = Date.now() < app.stage.boostUntil;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#04060f');
  sky.addColorStop(0.45, '#0c0b24');
  sky.addColorStop(0.78, '#2a1038');
  sky.addColorStop(1, boost ? '#5b1c46' : '#3c173f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);

  for (let i = 0; i < 80; i += 1) {
    const x = (i * 173.3) % W;
    const y = ((i * 97.7) % (horizon - 80)) + 12;
    const alpha = 0.18 + 0.55 * Math.abs(Math.sin(t * 0.7 + i * 1.3));
    ctx.fillStyle = `rgba(210, 230, 255, ${alpha.toFixed(3)})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }

  const sunX = W * 0.73;
  const sunY = horizon - 170;
  const sunR = 128;
  const sunGlow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, sunR * 2.1);
  sunGlow.addColorStop(0, boost ? 'rgba(255, 180, 80, 0.45)' : 'rgba(255, 120, 120, 0.3)');
  sunGlow.addColorStop(0.5, 'rgba(255, 70, 140, 0.12)');
  sunGlow.addColorStop(1, 'rgba(255, 70, 140, 0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(sunX - sunR * 2.2, sunY - sunR * 2.2, sunR * 4.4, sunR * 4.4);

  const sunGrad = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
  sunGrad.addColorStop(0, boost ? '#ffe08a' : '#ffcf7a');
  sunGrad.addColorStop(0.55, '#ff7b9c');
  sunGrad.addColorStop(1, '#b0327e');
  ctx.save();
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = sunGrad;
  ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);
  ctx.fillStyle = 'rgba(10, 7, 22, 0.82)';
  for (let i = 0; i < 11; i += 1) {
    const y = sunY - sunR + 18 + i * 19;
    ctx.fillRect(sunX - sunR, y, sunR * 2, 2 + i * 1.15);
  }
  ctx.restore();

  const hg = ctx.createLinearGradient(0, horizon - 20, 0, horizon + 30);
  hg.addColorStop(0, 'rgba(255, 80, 150, 0)');
  hg.addColorStop(0.5, boost ? 'rgba(255, 210, 120, 0.45)' : 'rgba(255, 90, 160, 0.35)');
  hg.addColorStop(1, 'rgba(255, 90, 160, 0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, horizon - 20, W, 50);

  drawMountains(ctx, horizon, '#0b0a1c', 96, 0.9, 0);
  drawMountains(ctx, horizon + 6, '#120d26', 62, 1.7, 120);

  for (let i = 0; i < 26; i += 1) {
    const x = i * 52 + 10;
    const w = 28 + (i % 4) * 7;
    const h = 18 + ((i * 37) % 70);
    ctx.fillStyle = '#080714';
    ctx.fillRect(x, horizon - h, w, h);
    ctx.fillStyle = 'rgba(255, 120, 190, 0.18)';
    ctx.fillRect(x + 6, horizon - h + 7, 2, 2);
  }

  const floor = ctx.createLinearGradient(0, horizon, 0, H);
  floor.addColorStop(0, '#12071f');
  floor.addColorStop(1, '#03040a');
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, W, H - horizon);

  ctx.save();
  ctx.lineWidth = 1;
  for (let i = -10; i <= 10; i += 1) {
    const x = vpX + i * 120;
    ctx.strokeStyle = `rgba(255, 72, 158, ${(0.05 + Math.min(0.18, Math.abs(i) * 0.012)).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(vpX, horizon);
    ctx.lineTo(x + (x - vpX) * 1.9, H);
    ctx.stroke();
  }
  const speed = boost ? 1.4 : 0.45;
  const offset = (t * speed) % 1;
  for (let i = 0; i < 20; i += 1) {
    const p = (i + offset) / 20;
    const y = horizon + (H - horizon) * p * p;
    ctx.strokeStyle = `rgba(255, 92, 170, ${(0.04 + p * 0.16).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(vpX - 26, horizon);
  ctx.lineTo(vpX + 26, horizon);
  ctx.lineTo(vpX + 390, H);
  ctx.lineTo(vpX - 390, H);
  ctx.closePath();
  const road = ctx.createLinearGradient(0, horizon, 0, H);
  road.addColorStop(0, 'rgba(8, 5, 16, 0.55)');
  road.addColorStop(1, 'rgba(2, 3, 8, 0.96)');
  ctx.fillStyle = road;
  ctx.fill();
  ctx.restore();

  const edgeGrad = ctx.createLinearGradient(0, horizon, 0, H);
  edgeGrad.addColorStop(0, 'rgba(255, 80, 170, 0.15)');
  edgeGrad.addColorStop(1, boost ? 'rgba(255, 220, 120, 0.9)' : 'rgba(255, 80, 170, 0.7)');
  ctx.strokeStyle = edgeGrad;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(vpX - 26, horizon);
  ctx.lineTo(vpX - 390, H);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(vpX + 26, horizon);
  ctx.lineTo(vpX + 390, H);
  ctx.stroke();

  ctx.fillStyle = boost ? 'rgba(255, 240, 170, 0.9)' : 'rgba(255, 120, 190, 0.55)';
  for (let i = 0; i < 12; i += 1) {
    const p = (i + offset) / 12;
    if (p > 1) continue;
    const y = horizon + (H - horizon) * p * p;
    const w = 1.5 + 10 * p;
    const h = 2 + 18 * p;
    ctx.fillRect(vpX - w / 2, y, w, h);
  }

  for (let i = 0; i < 7; i += 1) {
    const p = ((i + offset * 1.3) % 7) / 7;
    const y = horizon + (H - horizon) * p * p;
    const spread = 30 + 360 * p;
    const h = 8 + 46 * p;
    ctx.fillStyle = 'rgba(7, 8, 18, 0.9)';
    ctx.fillRect(vpX - spread - 4, y - h, 8, h);
    ctx.fillRect(vpX + spread - 4, y - h, 8, h);
    ctx.fillStyle = boost ? 'rgba(255, 220, 120, 0.9)' : 'rgba(67, 232, 255, 0.8)';
    ctx.fillRect(vpX - spread - 3, y - h, 6, 2);
    ctx.fillRect(vpX + spread - 3, y - h, 6, 2);
  }

  for (let i = 0; i < 18; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const p = (i * 0.137 + t * (boost ? 0.9 : 0.28)) % 1;
    const y = horizon + (H - horizon) * p * p;
    const spread = 60 + 520 * p + (i % 5) * 18;
    const len = 6 + 30 * p;
    ctx.strokeStyle = side < 0 ? 'rgba(67, 232, 255, 0.28)' : 'rgba(255, 70, 150, 0.26)';
    ctx.lineWidth = 1 + p * 1.6;
    ctx.beginPath();
    ctx.moveTo(vpX + side * spread, y);
    ctx.lineTo(vpX + side * spread, y + len);
    ctx.stroke();
  }

  drawCar(ctx, vpX + Math.sin(t * 0.6) * 46, H - 70, boost, t);

  ctx.font = '600 13px "Cascadia Mono", Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(233, 240, 250, 0.55)';
  ctx.fillText('NIGHT RUN // SECTOR 09', 28, 40);
  ctx.fillStyle = 'rgba(196, 255, 69, 0.8)';
  ctx.fillText('WAVE 07', 28, 62);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(233, 240, 250, 0.55)';
  ctx.fillText('SCORE 084,250', W - 28, 40);
  ctx.fillStyle = boost ? 'rgba(255, 190, 61, 0.95)' : 'rgba(67, 232, 255, 0.75)';
  ctx.fillText(boost ? 'PEAK MOMENT' : 'LIVE RUN', W - 28, 62);
  ctx.textAlign = 'left';

  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Stage source + overlay frame
// ---------------------------------------------------------------------------

function setStageMode(mode) {
  if (mode === 'video' && !app.stage.hasVideo) {
    dom.videoFileInput.click();
    return;
  }

  app.stage.mode = mode;
  const videoMode = mode === 'video' && app.stage.hasVideo;

  dom.gameCanvas.hidden = videoMode;
  dom.stageVideo.hidden = !videoMode;
  dom.resetStageBtn.hidden = !app.stage.hasVideo;

  document.querySelectorAll('[data-stage-source]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.stageSource === mode);
  });

  if (videoMode) {
    setText(dom.stageSourceBadgeText, 'LOCAL MP4 PREVIEW');
    setText(dom.stageSourceText, 'Local MP4 preview');
    setText(dom.stageFileText, app.stage.fileName || 'Local video');
    const played = dom.stageVideo.play();
    if (played && typeof played.catch === 'function') played.catch(() => {});
  } else {
    dom.stageVideo.pause();
    setText(dom.stageSourceBadgeText, 'PROCEDURAL GAMEPLAY · 60 FPS');
    setText(dom.stageSourceText, 'Procedural demo scene');
    setText(dom.stageFileText, 'No local video loaded');
  }
}

function loadVideoFile(file, options = {}) {
  if (!file) return;
  const isVideo = /^video\//.test(file.type || '') || /\.mp4$/i.test(file.name || '');
  if (!isVideo) {
    toast({ kind: 'error', title: 'UNSUPPORTED FILE', text: 'Drop a local .mp4 or video file.' });
    return;
  }

  if (app.stage.objectUrl) URL.revokeObjectURL(app.stage.objectUrl);
  app.stage.objectUrl = URL.createObjectURL(file);
  app.stage.fileName = file.name || 'local-video.mp4';
  app.stage.hasVideo = true;

  dom.stageVideo.src = app.stage.objectUrl;
  dom.stageVideo.load();
  setStageMode('video');

  const played = dom.stageVideo.play();
  if (played && typeof played.catch === 'function') played.catch(() => {});
  if (!options.silent) {
    toast({ kind: 'success', title: 'MP4 LOADED', text: 'Video preview loaded.' });
  }
}

function resetStageVideo() {
  if (dom.stageVideo) {
    try { dom.stageVideo.pause(); } catch { /* ignore */ }
    dom.stageVideo.removeAttribute('src');
    dom.stageVideo.load();
  }
  if (app.stage.objectUrl) URL.revokeObjectURL(app.stage.objectUrl);
  app.stage.objectUrl = '';
  app.stage.fileName = '';
  app.stage.hasVideo = false;
  dom.videoFileInput.value = '';
  setStageMode('procedural');
}

function updateOverlayFrame() {
  const base = app.overlayBaseUrl || OVERLAY_FALLBACK;
  const separator = base.includes('?') ? '&' : '?';
  const url = `${base}${separator}theme=${encodeURIComponent(app.stage.theme)}&preview=1`;
  if (dom.overlayFrame.getAttribute('src') !== url) {
    dom.overlayFrame.setAttribute('src', url);
  }
  setText(dom.footerOverlayUrl, base);
}

// ---------------------------------------------------------------------------
// Settings + OBS
// ---------------------------------------------------------------------------

function applySettings() {
  api.updateSettings({
    threshold: Number(dom.thresholdRange.value),
    sustainMs: Number(dom.sustainRange.value),
    cooldownMs: Number(dom.cooldownRange.value),
    expressionBoost: dom.expressionBoostStudio.checked,
  })
    .then((result) => {
      if (result && result.config) syncSettingsUI(result.config);
    })
    .catch((err) => {
      toast({ kind: 'error', title: 'SETTINGS ERROR', text: err && err.message ? err.message : 'Could not update detector settings.' });
    });
}

function scheduleSettings() {
  if (app.settingsTimer) window.clearTimeout(app.settingsTimer);
  app.settingsTimer = window.setTimeout(() => {
    app.settingsTimer = null;
    applySettings();
  }, 140);
}

function wireSettings() {
  const syncOutputs = () => {
    setText(dom.thresholdOutput, String(Math.round(Number(dom.thresholdRange.value))));
    setText(dom.sustainOutput, `${(Number(dom.sustainRange.value) / 1000).toFixed(1)}s`);
    setText(dom.cooldownOutput, `${Math.round(Number(dom.cooldownRange.value) / 1000)}s`);
  };

  on(dom.thresholdRange, 'input', () => {
    syncOutputs();
    scheduleSettings();
  });
  on(dom.sustainRange, 'input', () => {
    syncOutputs();
    scheduleSettings();
  });
  on(dom.cooldownRange, 'input', () => {
    syncOutputs();
    scheduleSettings();
  });

  on(dom.expressionBoostStudio, 'change', () => {
    dom.expressionBoostCheck.checked = dom.expressionBoostStudio.checked;
    scheduleSettings();
  });
  on(dom.expressionBoostCheck, 'change', () => {
    dom.expressionBoostStudio.checked = dom.expressionBoostCheck.checked;
    scheduleSettings();
  });

  syncOutputs();
}

async function connectObs() {
  const password = dom.obsPasswordInput.value;
  const payload = password ? { password } : {};
  dom.obsConnectBtn.disabled = true;
  const previous = dom.obsConnectBtn.textContent;
  dom.obsConnectBtn.textContent = 'CONNECTING';
  try {
    const result = await api.obsConnect(payload);
    if (result && result.connected) {
      toast({ kind: 'success', title: 'OBS CONNECTED', text: 'OBS connected.' });
    } else {
      toast({
        kind: 'error',
        title: 'OBS OFFLINE',
        text: result && result.error ? result.error : 'Could not reach OBS WebSocket.',
      });
    }
  } catch (err) {
    toast({ kind: 'error', title: 'OBS ERROR', text: err && err.message ? err.message : 'OBS connection failed.' });
  } finally {
    dom.obsConnectBtn.disabled = false;
    dom.obsConnectBtn.textContent = previous || 'CONNECT';
    if (app.lastState && app.lastState.obs) {
      dom.obsConnectBtn.textContent = app.lastState.obs.connected ? 'RECONNECT' : 'CONNECT';
    }
  }
}

function wireObs() {
  on(dom.obsConnectBtn, 'click', () => { void connectObs(); });
  on(dom.obsDisconnectBtn, 'click', async () => {
    dom.obsDisconnectBtn.disabled = true;
    try {
      await api.obsDisconnect();
      toast({ kind: 'info', title: 'OBS DISCONNECTED', text: 'OBS disconnected.' });
    } catch (err) {
      toast({ kind: 'error', title: 'OBS ERROR', text: err && err.message ? err.message : 'Disconnect failed.' });
    } finally {
      dom.obsDisconnectBtn.disabled = false;
    }
  });
  on(dom.obsPasswordInput, 'keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void connectObs();
    }
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

async function previewExport(format) {
  const safeFormat = ['edl', 'txt', 'json'].includes(format) ? format : 'edl';
  try {
    const result = await api.exportPreview(safeFormat);
    app.exportFormat = safeFormat;
    app.dialogText = result && typeof result.text === 'string' ? result.text : '';
    setText(dom.dialogKicker, '');
    setText(dom.dialogTitle, `Export · ${safeFormat.toUpperCase()}`);
    setText(dom.exportPreviewText, app.dialogText);
    dom.exportPreviewText.scrollTop = 0;
    setText(dom.exportMeta, `${app.clips.length} clip${app.clips.length === 1 ? '' : 's'}`);
    if (!dom.exportDialog.open) dom.exportDialog.showModal();
  } catch (err) {
    toast({ kind: 'error', title: 'EXPORT ERROR', text: err && err.message ? err.message : 'Could not build the export.' });
  }
}

async function saveExport(format, closeAfter = false) {
  const safeFormat = ['edl', 'txt', 'json'].includes(format) ? format : 'edl';
  dom.dialogSaveBtn.disabled = true;
  try {
    const result = await api.exportSave(safeFormat);
    if (result && result.saved) {
      toast({
        kind: 'success',
        title: `${safeFormat.toUpperCase()} SAVED`,
        text: result.path ? `${result.path}` : 'Export written to disk.',
        ttl: 4000,
      });
      if (closeAfter && dom.exportDialog.open) dom.exportDialog.close();
    }
  } catch (err) {
    toast({ kind: 'error', title: 'EXPORT ERROR', text: err && err.message ? err.message : 'Could not save the export.' });
  } finally {
    dom.dialogSaveBtn.disabled = false;
  }
}

function wireExports() {
  document.querySelectorAll('[data-export-preview]').forEach((button) => {
    on(button, 'click', () => { void previewExport(button.dataset.exportPreview); });
  });
  document.querySelectorAll('[data-export-save]').forEach((button) => {
    on(button, 'click', () => { void saveExport(button.dataset.exportSave, false); });
  });

  on(dom.dialogCloseBtn, 'click', () => dom.exportDialog.close());
  on(dom.dialogCopyBtn, 'click', () => {
    if (app.dialogText) void copyText(app.dialogText, 'Copied.');
  });
  on(dom.dialogSaveBtn, 'click', () => { void saveExport(app.exportFormat, true); });
  on(dom.exportDialog, 'click', (event) => {
    if (event.target === dom.exportDialog) dom.exportDialog.close();
  });

  // Highlight Reel & NLE verification dialog
  if (dom.nleProofBtn) {
    on(dom.nleProofBtn, 'click', () => {
      if (dom.nleDialog && !dom.nleDialog.open) dom.nleDialog.showModal();
    });
  }

  if (dom.nleDialogCloseBtn) {
    on(dom.nleDialogCloseBtn, 'click', () => {
      if (dom.nleDialog && dom.nleDialog.open) dom.nleDialog.close();
    });
  }

  if (dom.nleDialog) {
    on(dom.nleDialog, 'click', (event) => {
      if (event.target === dom.nleDialog) dom.nleDialog.close();
    });
  }

  if (dom.nlePlayHighlightsBtn) {
    on(dom.nlePlayHighlightsBtn, 'click', () => { void loadHighlightVideoToStage(); });
  }

  if (dom.nleLoadSampleBtn) {
    on(dom.nleLoadSampleBtn, 'click', () => { void loadSampleFootageToStage(); });
  }

  if (dom.nleOpenFolderBtn) {
    on(dom.nleOpenFolderBtn, 'click', () => { void openDemoFilesFolder(); });
  }

  if (dom.nleCopyStepsBtn) {
    on(dom.nleCopyStepsBtn, 'click', () => { void copyNleImportSteps(); });
  }
}

async function loadHighlightVideoToStage() {
  try {
    if (!api || typeof api.getHighlightsVideoBuffer !== 'function') {
      throw new Error('Highlight reel API unavailable.');
    }
    toast({ kind: 'info', title: 'LOADING HIGHLIGHTS', text: 'Retrieving conformed highlight reel...' });
    const buffer = await api.getHighlightsVideoBuffer();
    if (!buffer) throw new Error('No video data received.');
    const blob = new Blob([buffer], { type: 'video/mp4' });
    const file = new File([blob], 'clippulse-highlights.mp4', { type: 'video/mp4' });
    loadVideoFile(file, { silent: true });
    if (dom.nleDialog && dom.nleDialog.open) dom.nleDialog.close();
    toast({
      kind: 'success',
      title: 'HIGHLIGHT REEL LOADED',
      text: 'clippulse-highlights.mp4 active in stage (30s conformed cuts).',
      ttl: 4500,
    });
  } catch (err) {
    toast({
      kind: 'error',
      title: 'LOAD FAILED',
      text: err && err.message ? err.message : 'Could not load highlight reel.',
    });
  }
}

async function loadSampleFootageToStage() {
  try {
    if (!api || typeof api.getSampleVideoBuffer !== 'function') {
      throw new Error('Sample footage API unavailable.');
    }
    toast({ kind: 'info', title: 'LOADING FOOTAGE', text: 'Retrieving bundled sample footage...' });
    const buffer = await api.getSampleVideoBuffer();
    if (!buffer) throw new Error('No video data received.');
    const blob = new Blob([buffer], { type: 'video/mp4' });
    const file = new File([blob], 'clippulse-sample-gameplay.mp4', { type: 'video/mp4' });
    loadVideoFile(file, { silent: true });
    if (dom.nleDialog && dom.nleDialog.open) dom.nleDialog.close();
    toast({
      kind: 'success',
      title: 'SAMPLE FOOTAGE LOADED',
      text: 'clippulse-sample-gameplay.mp4 active in stage with burned-in timecode.',
      ttl: 4500,
    });
  } catch (err) {
    toast({
      kind: 'error',
      title: 'LOAD FAILED',
      text: err && err.message ? err.message : 'Could not load sample footage.',
    });
  }
}

window.__clippulseLoadSample = loadSampleFootageToStage;
window.__clippulseLoadHighlights = loadHighlightVideoToStage;

async function openDemoFilesFolder() {
  try {
    if (!api || typeof api.openDemoFolder !== 'function') {
      throw new Error('Demo folder API unavailable.');
    }
    await api.openDemoFolder();
    toast({
      kind: 'success',
      title: 'FOLDER OPENED',
      text: 'demo-assets folder opened in file explorer.',
      ttl: 3500,
    });
  } catch (err) {
    toast({
      kind: 'error',
      title: 'OPEN FAILED',
      text: err && err.message ? err.message : 'Could not open demo-assets folder.',
    });
  }
}

async function copyNleImportSteps() {
  const steps = [
    'ClipPulse — Conformed Highlight Reel & NLE Export',
    '',
    '1. 1-Click Direct Video Playback (VLC / Media Player):',
    '   Open demo-assets/clippulse-highlights.mp4 directly to verify the 30-second conformed cut.',
    '   Event 1 (00:00:00 - 00:00:15) cut from source 10s-25s (+22.2 BPM surge)',
    '   Event 2 (00:00:15 - 00:00:30) cut from source 35s-50s (+30.4 BPM spike)',
    '',
    '2. DaVinci Resolve (3 Clicks):',
    '   - Drag clippulse-sample-gameplay.mp4 into the Media Pool.',
    '   - Go to File -> Import -> Timeline... (Ctrl+Shift+I) and select clippulse-highlights.edl.',
    '   - Confirm 30 fps in the conform dialog. Tracks V1/A1 are cut at the exact peak moments.',
    '',
    '3. Adobe Premiere Pro (3 Clicks):',
    '   - Drag clippulse-sample-gameplay.mp4 into the Project bin.',
    '   - Go to File -> Import... (Ctrl+I) and select clippulse-highlights.edl.',
    '   - Right-click generated sequence -> Link Media... -> Select clippulse-sample-gameplay.mp4.',
    '',
    '4. YouTube / Twitch Chapters:',
    '   Copy clippulse-chapters.txt directly into the video description for instant chapter markers.',
  ].join('\n');

  await copyText(steps, 'EDL & chapter steps copied to clipboard.');
}

// ---------------------------------------------------------------------------
// Inspector + panel jumps
// ---------------------------------------------------------------------------

function switchInspectorTab(tab) {
  app.inspectorTab = tab === 'events' ? 'events' : 'telemetry';
  document.querySelectorAll('[data-inspector-tab]').forEach((button) => {
    const active = button.dataset.inspectorTab === app.inspectorTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  dom.inspectorJson.hidden = app.inspectorTab !== 'telemetry';
  dom.inspectorEvents.hidden = app.inspectorTab !== 'events';
  if (app.inspectorTab === 'telemetry') renderInspector();
  else renderEvents();
}

function expandPanel(panel, toggle) {
  if (!panel) return;
  panel.classList.remove('is-collapsed');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
}

function wireInspector() {
  document.querySelectorAll('[data-inspector-tab]').forEach((button) => {
    on(button, 'click', () => switchInspectorTab(button.dataset.inspectorTab));
  });

  on(dom.inspectorToggle, 'click', () => {
    const collapsed = dom.inspectorPanel.classList.toggle('is-collapsed');
    dom.inspectorToggle.setAttribute('aria-expanded', String(!collapsed));
    dom.inspectorToggle.setAttribute('aria-label', collapsed ? 'Expand signal inspector' : 'Collapse signal inspector');
    if (!collapsed) renderInspector();
  });

  on(dom.setupToggle, 'click', () => {
    const collapsed = dom.setupPanel.classList.toggle('is-collapsed');
    dom.setupToggle.setAttribute('aria-expanded', String(!collapsed));
    dom.setupToggle.setAttribute('aria-label', collapsed ? 'Expand detector setup' : 'Collapse detector setup');
  });

  on(dom.inspectorJumpBtn, 'click', () => {
    expandPanel(dom.inspectorPanel, dom.inspectorToggle);
    renderInspector();
    dom.inspectorPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  on(dom.settingsJumpBtn, 'click', () => {
    expandPanel(dom.setupPanel, dom.setupToggle);
    dom.setupPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  on(dom.reviewClipsBtn, 'click', () => {
    dom.timelinePanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ---------------------------------------------------------------------------
// Simulator controls
// ---------------------------------------------------------------------------

function wireSimulator() {
  on(dom.simSpikeBtn, 'click', () => {
    if (!app.provider || app.mode !== 'simulator') return;
    app.provider.triggerSpike();
    toast({ kind: 'sim', title: 'SIM TRIGGER', text: 'Spike injected (+18 BPM).' });
  });

  on(dom.simGaspBtn, 'click', () => {
    if (!app.provider || app.mode !== 'simulator') return;
    app.provider.triggerGasp();
    toast({ kind: 'sim', title: 'SIM TRIGGER', text: 'Gasp injected.' });
  });

  on(dom.simLeanBtn, 'click', () => {
    if (!app.provider || app.mode !== 'simulator') return;
    app.provider.triggerLean();
    toast({ kind: 'sim', title: 'SIM TRIGGER', text: 'Validation lost injected.' });
  });

  on(dom.simResetBtn, 'click', () => {
    if (!app.provider || app.mode !== 'simulator') return;
    app.provider.resetSimulator();
    toast({ kind: 'sim', title: 'SIM RESET', text: 'Simulator reset.' });
  });

  on(dom.simSkipBtn, 'click', async () => {
    try {
      const result = await api.skipWarmup();
      if (result && result.ok) {
        toast({ kind: 'sim', title: 'BASELINE PRIMED', text: 'Warm-up skipped.' });
      } else {
        toast({ kind: 'error', title: 'SKIP UNAVAILABLE', text: result && result.error ? result.error : 'Skip warm-up is simulator-only.' });
      }
    } catch (err) {
      toast({ kind: 'error', title: 'SKIP ERROR', text: err && err.message ? err.message : 'Could not skip warm-up.' });
    }
  });
}

// ---------------------------------------------------------------------------
// Gate + header + privacy wiring
// ---------------------------------------------------------------------------

function wireGate() {
  on(dom.consentCheck, 'change', () => {
    updateGate();
    api.setConsent(dom.consentCheck.checked).catch((err) => {
      toast({ kind: 'error', title: 'CONSENT ERROR', text: err && err.message ? err.message : 'Consent could not be recorded.' });
    });
  });

  on(dom.startLiveBtn, 'click', () => { void launch('live'); });
  on(dom.startSimBtn, 'click', () => { void launch('simulator'); });

  on(dom.keyToggleBtn, 'click', () => {
    const showing = dom.apiKeyInput.type === 'text';
    dom.apiKeyInput.type = showing ? 'password' : 'text';
    setText(dom.keyToggleBtn, showing ? 'SHOW' : 'HIDE');
  });

  on(dom.apiKeyInput, 'input', () => {
    app.keyDirty = true;
    updateKeyStatus();
    updateGate();
  });

  on(dom.apiKeyInput, 'change', () => { void saveKey(); });
  on(dom.apiKeyInput, 'blur', () => {
    if (app.keyDirty) void saveKey();
  });
  on(dom.apiKeyInput, 'keydown', (event) => {
    if (event.key === 'Enter' && !dom.startLiveBtn.disabled) {
      event.preventDefault();
      void launch('live');
    }
  });

  on(dom.previewFacelessCheck, 'change', () => {
    app.faceless = dom.previewFacelessCheck.checked;
    applyPrivacy();
  });
}

function wireHeader() {
  on(dom.stopSessionBtn, 'click', () => { void stopSession(); });
  on(dom.killBtn, 'click', () => { void engageKill(); });
  on(dom.newSessionBtn, 'click', newSession);

  on(dom.numericOnlyCheck, 'change', () => {
    app.numericOnly = dom.numericOnlyCheck.checked;
    endAlignHold();
    applyPrivacy();
  });

  on(dom.alignHoldBtn, 'pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try { dom.alignHoldBtn.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    startAlignHold();
  });
  on(dom.alignHoldBtn, 'pointerup', () => endAlignHold());
  on(dom.alignHoldBtn, 'pointercancel', () => endAlignHold());
  on(dom.alignHoldBtn, 'lostpointercapture', () => endAlignHold());
  on(dom.alignHoldBtn, 'keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      startAlignHold();
    }
  });
  on(dom.alignHoldBtn, 'keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') endAlignHold();
  });
  on(dom.alignHoldBtn, 'blur', () => endAlignHold());
}

// ---------------------------------------------------------------------------
// Stage wiring
// ---------------------------------------------------------------------------

function wireStage() {
  document.querySelectorAll('[data-stage-source]').forEach((button) => {
    on(button, 'click', () => setStageMode(button.dataset.stageSource));
  });

  on(dom.themeSelect, 'change', () => {
    app.stage.theme = dom.themeSelect.value;
    try { localStorage.setItem('clippulse.theme', app.stage.theme); } catch { /* ignore */ }
    updateOverlayFrame();
  });

  on(dom.overlayToggle, 'change', () => {
    dom.overlaySlot.classList.toggle('is-hidden', !dom.overlayToggle.checked);
  });

  on(dom.openOverlayBtn, 'click', async () => {
    try {
      await api.openOverlay();
      toast({ kind: 'info', title: 'OVERLAY OPENED', text: 'Overlay opened in browser.' });
    } catch (err) {
      toast({ kind: 'error', title: 'OVERLAY ERROR', text: err && err.message ? err.message : 'Could not open the overlay.' });
    }
  });

  on(dom.copyOverlayBtn, 'click', () => {
    const base = app.overlayBaseUrl || OVERLAY_FALLBACK;
    void copyText(`${base}?theme=${app.stage.theme}`, 'OBS browser source URL copied.');
  });

  on(dom.browseVideoBtn, 'click', () => dom.videoFileInput.click());
  on(dom.videoFileInput, 'change', () => {
    const file = dom.videoFileInput.files && dom.videoFileInput.files[0];
    if (file) loadVideoFile(file);
    dom.videoFileInput.value = '';
  });
  on(dom.resetStageBtn, 'click', resetStageVideo);
  on(dom.stageVideo, 'error', () => {
    if (dom.stageVideo.getAttribute('src')) {
      toast({ kind: 'error', title: 'VIDEO ERROR', text: 'That file could not be played in the preview stage.' });
    }
  });

  let dragDepth = 0;
  on(dom.stageWrap, 'dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    dom.stageWrap.classList.add('drag-over');
    dom.dropHint.hidden = false;
  });
  on(dom.stageWrap, 'dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  on(dom.stageWrap, 'dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      dom.stageWrap.classList.remove('drag-over');
      dom.dropHint.hidden = true;
    }
  });
  on(dom.stageWrap, 'drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    dom.stageWrap.classList.remove('drag-over');
    dom.dropHint.hidden = true;
    const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
    if (file) loadVideoFile(file);
  });

  on(window, 'dragover', (event) => event.preventDefault());
  on(window, 'drop', (event) => event.preventDefault());
}

// ---------------------------------------------------------------------------
// Bridge + boot
// ---------------------------------------------------------------------------

function restoreTheme() {
  let stored = '';
  try { stored = localStorage.getItem('clippulse.theme') || ''; } catch { /* ignore */ }
  if (stored === 'unity' || stored === 'minimal' || stored === 'compact' || stored === 'cyber') {
    app.stage.theme = stored;
  } else {
    app.stage.theme = 'unity';
  }
  dom.themeSelect.value = app.stage.theme;
}

function startClock() {
  if (app.clockTimer) window.clearInterval(app.clockTimer);
  app.clockTimer = window.setInterval(() => {
    if (app.sessionActive && app.sessionStartMs) {
      dom.sessionClock.textContent = formatClock((Date.now() - app.sessionStartMs) / 1000);
    }
  }, 500);
}

function wireWindow() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopStageLoop();
      stopSimScope();
      return;
    }
    if (!dom.studioScreen.hidden) {
      startStageLoop();
      ensureSimScope();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (app.stage.objectUrl) {
      try { URL.revokeObjectURL(app.stage.objectUrl); } catch { /* ignore */ }
    }
    void stopProvider();
  });
}

function wireBridge() {
  api.onState(handleState);
  api.onClip(handleClip);
  api.onEvent(handleEvent);
  api.onKill(handleKill);
  api.onToast(handleToast);
}

function boot() {
  restoreTheme();
  wireGate();
  wireHeader();
  wireStage();
  wireInspector();
  wireSettings();
  wireObs();
  wireExports();
  wireSimulator();
  wireWindow();
  wireBridge();

  renderClips();
  renderEvents();
  updateKeyStatus();
  updateGate();
  applyPrivacy();
  updateOverlayFrame();
  startClock();
  void loadPreflight();
}

function showBridgeError() {
  const status = document.getElementById('gateStatus');
  if (status) {
    status.hidden = false;
    status.textContent = 'ClipPulse could not load its preload bridge. Restart the app.';
  }
  const note = document.getElementById('gateNote');
  if (note) note.textContent = 'Preload bridge unavailable.';
}

if (!api) {
  showBridgeError();
} else {
  boot();
}

