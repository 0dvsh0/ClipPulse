'use strict';

// ClipPulse OBS overlay runtime.
//
// Receives numeric state packets from ws://127.0.0.1:4789/ws and paints the
// HUD. It never receives video, images, API keys, or file paths. Rendering is
// requestAnimationFrame-driven so the trace stays smooth between 80 ms state
// broadcasts.

(() => {
  const params = new URLSearchParams(window.location.search);
  const requestedTheme = params.get('theme') || 'unity';
  if (requestedTheme === 'unity' || requestedTheme === 'minimal' || requestedTheme === 'compact' || requestedTheme === 'cyber') {
    document.body.dataset.theme = requestedTheme;
  }
  if (params.get('preview') === '1') {
    document.body.classList.add('preview');
  }

  const $ = (id) => document.getElementById(id);
  const els = {
    stage: $('stage'),
    hud: $('hud'),
    modeBadge: $('modeBadge'),
    validation: $('validation'),
    validationText: $('validationText'),
    bpm: $('bpm'),
    delta: $('delta'),
    baseline: $('baseline'),
    confidence: $('confidence'),
    breathRate: $('breathRate'),
    breathRing: $('breathRing'),
    hypeFill: $('hypeFill'),
    hypeThreshold: $('hypeThreshold'),
    hypeValue: $('hypeValue'),
    packetCount: $('packetCount'),
    fps: $('fps'),
    sessionTime: $('sessionTime'),
    pulseCanvas: $('pulseCanvas'),
    breathCanvas: $('breathCanvas'),
    clipToast: $('clipToast'),
    clipReason: $('clipReason'),
    clipSub: $('clipSub'),
    simBadge: $('simBadge'),
    linkLost: $('linkLost'),
  };

  const RING_CIRCUMFERENCE = 2 * Math.PI * 42;

  const target = {
    bpm: null,
    breathRate: null,
    hypeScore: 0,
    pulseTrace: [],
    breathTrace: [],
  };

  const display = {
    bpm: null,
    breathRate: null,
    pulseTrace: [],
    breathTrace: [],
    sessionSec: 0,
    sessionAt: performance.now(),
    sessionRunning: false,
    flashUntil: 0,
  };

  let latest = null;
  let latestAt = 0;
  let ws = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let linkLostTimer = null;
  let toastTimer = null;
  let flashTimer = null;
  let lastClockText = '';
  let lastMode = '';

  const pulseCtx = els.pulseCanvas.getContext('2d');
  const breathCtx = els.breathCanvas.getContext('2d');
  const pulseSize = { w: 1, h: 1, dpr: 1 };
  const breathSize = { w: 1, h: 1, dpr: 1 };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatClock(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
  }

  function formatValue(value, digits = 0) {
    const n = finiteOrNull(value);
    return n == null ? '--' : n.toFixed(digits);
  }

  function finiteOrNull(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function validationTone(code, status) {
    if (status === 'idle' || status === 'error') return 'idle';
    if (code === 0) return 'ok';
    if (code === 10 || code == null) return 'warn';
    return 'bad';
  }

  // -------------------------------------------------------------------
  // Canvas sizing
  // -------------------------------------------------------------------

  function sizeCanvas(canvas, ctx, size) {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (size.w !== w || size.h !== h || size.dpr !== dpr) {
      size.w = w;
      size.h = h;
      size.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resizeCanvases() {
    sizeCanvas(els.pulseCanvas, pulseCtx, pulseSize);
    sizeCanvas(els.breathCanvas, breathCtx, breathSize);
  }

  // -------------------------------------------------------------------
  // WebSocket link
  // -------------------------------------------------------------------

  const wsUrl = (() => {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return `${protocol}://${window.location.host}/ws`;
    }
    return 'ws://127.0.0.1:4789/ws';
  })();

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = Math.min(5000, 500 * 2 ** Math.min(reconnectAttempts, 4));
    reconnectAttempts += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay + Math.random() * 180);
  }

  function showLinkLost(visible) {
    if (!visible) {
      if (linkLostTimer) {
        window.clearTimeout(linkLostTimer);
        linkLostTimer = null;
      }
      els.linkLost.hidden = true;
      return;
    }
    if (linkLostTimer || !els.linkLost.hidden) return;
    linkLostTimer = window.setTimeout(() => {
      linkLostTimer = null;
      els.linkLost.hidden = false;
    }, 1400);
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      showLinkLost(true);
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      reconnectAttempts = 0;
      showLinkLost(false);
    });

    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'state') applyState(message);
      else if (message.type === 'clip') showClip(message.clip);
    });

    ws.addEventListener('close', () => {
      ws = null;
      showLinkLost(true);
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      try { ws.close(); } catch { /* ignore */ }
    });
  }

  // -------------------------------------------------------------------
  // State → DOM
  // -------------------------------------------------------------------

  function applyState(state) {
    latest = state;
    latestAt = performance.now();

    const mode = state.mode === 'LIVE' || state.mode === 'SIMULATOR' ? state.mode : 'IDLE';
    const idle = mode === 'IDLE' || state.status === 'idle';
    document.body.classList.toggle('is-idle', idle);
    document.body.classList.toggle('is-sim', mode === 'SIMULATOR');

    if (mode !== lastMode) {
      lastMode = mode;
      els.modeBadge.textContent = mode === 'SIMULATOR' ? 'SIM' : mode;
      els.modeBadge.dataset.mode = mode;
      els.modeBadge.title = mode === 'SIMULATOR' ? 'SIMULATOR MODE — NO LIVE CAMERA' : mode;
    }

    const tone = validationTone(state.validationCode, state.status);
    const label = idle ? 'WAITING' : (state.validationState || 'WAITING');
    if (els.validationText.textContent !== label) els.validationText.textContent = label;
    if (els.validation.dataset.state !== tone) els.validation.dataset.state = tone;

    target.bpm = finiteOrNull(state.bpm);
    target.breathRate = finiteOrNull(state.breathRate);
    target.hypeScore = clamp(Number(state.hypeScore) || 0, 0, 100);
    target.pulseTrace = Array.isArray(state.pulseTrace) ? state.pulseTrace : [];
    target.breathTrace = Array.isArray(state.breathTrace) ? state.breathTrace : [];

    display.sessionSec = Math.max(0, Number(state.sessionSec) || 0);
    display.sessionAt = performance.now();
    display.sessionRunning = !idle;

    const delta = finiteOrNull(state.deltaBpm);
    if (delta == null) {
      els.delta.textContent = '--';
      els.delta.className = 'delta';
    } else {
      const sign = delta > 0 ? '+' : '';
      els.delta.textContent = `${sign}${delta.toFixed(1)}`;
      els.delta.className = `delta ${delta > 0.2 ? 'up' : delta < -0.2 ? 'down' : ''}`.trim();
    }

    const base = finiteOrNull(state.baselineBpm);
    els.baseline.textContent = base == null ? 'BASE --' : `BASE ${base.toFixed(0)}`;
    const confidence = finiteOrNull(state.confidence);
    els.confidence.textContent = confidence == null
      ? 'CONF --'
      : `CONF ${Math.round(clamp(confidence, 0, 1) * 100)}%`;

    const threshold = clamp(Number(state.threshold) || 70, 0, 100);
    els.hypeThreshold.style.left = `${threshold}%`;
    els.hypeFill.style.width = `${target.hypeScore}%`;
    els.hypeFill.classList.toggle('hot', target.hypeScore >= threshold);
    els.hypeValue.textContent = String(Math.round(target.hypeScore));

    els.packetCount.textContent = `PKT ${Math.max(0, Math.floor(Number(state.packetCount) || 0))}`;
    els.fps.textContent = `${formatValue(state.fps, 1)} FPS`;
    els.simBadge.hidden = mode !== 'SIMULATOR';

    if (Number.isFinite(target.breathRate)) {
      const progress = clamp(target.breathRate / 30, 0.02, 1);
      els.breathRing.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
    } else {
      els.breathRing.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
    }
  }

  function showClip(clip) {
    if (!clip || typeof clip !== 'object') return;

    els.clipReason.textContent = clip.reason || 'Sustained hype';
    const peak = finiteOrNull(clip.peakBpm);
    const pre = finiteOrNull(clip.preRollSec) ?? 20;
    const post = finiteOrNull(clip.postRollSec) ?? 10;
    els.clipSub.textContent = `Peak ${peak == null ? '--' : peak.toFixed(0)} BPM`;

    els.clipToast.hidden = false;
    els.clipToast.style.animation = 'none';
    void els.clipToast.offsetWidth;
    els.clipToast.style.animation = '';

    els.hud.classList.add('clip-flash');
    display.flashUntil = performance.now() + 1300;

    if (toastTimer) window.clearTimeout(toastTimer);
    if (flashTimer) window.clearTimeout(flashTimer);
    toastTimer = window.setTimeout(() => {
      els.clipToast.hidden = true;
      toastTimer = null;
    }, 4700);
    flashTimer = window.setTimeout(() => {
      els.hud.classList.remove('clip-flash');
      flashTimer = null;
    }, 1300);
  }

  // -------------------------------------------------------------------
  // Trace smoothing
  // -------------------------------------------------------------------

  function sameLength(a, b) {
    return a.length === b.length;
  }

  function easeTrace(current, incoming, alpha) {
    if (!Array.isArray(incoming) || incoming.length === 0) return current;
    if (!sameLength(current, incoming)) {
      return incoming.slice(-160).map(Number).filter(Number.isFinite);
    }
    for (let i = 0; i < incoming.length; i += 1) {
      const next = Number(incoming[i]);
      if (!Number.isFinite(next)) continue;
      current[i] += (next - current[i]) * alpha;
    }
    return current;
  }

  // -------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------

  function drawPulse(now) {
    if (!pulseCtx) return;
    const { w, h } = pulseSize;
    pulseCtx.clearRect(0, 0, w, h);

    pulseCtx.strokeStyle = 'rgba(151, 185, 226, 0.09)';
    pulseCtx.lineWidth = 1;
    for (const y of [h * 0.3, h * 0.7]) {
      pulseCtx.beginPath();
      pulseCtx.moveTo(0, Math.round(y) + 0.5);
      pulseCtx.lineTo(w, Math.round(y) + 0.5);
      pulseCtx.stroke();
    }

    const trace = display.pulseTrace;
    const flash = now < display.flashUntil;

    if (!trace || trace.length < 2) {
      const idleY = h * 0.55;
      pulseCtx.strokeStyle = 'rgba(151, 185, 226, 0.24)';
      pulseCtx.lineWidth = 1.2;
      pulseCtx.beginPath();
      pulseCtx.moveTo(0, idleY);
      pulseCtx.lineTo(w, idleY);
      pulseCtx.stroke();
      return;
    }

    const isUnity = document.body.dataset.theme === 'unity';
    const gradient = pulseCtx.createLinearGradient(0, 0, w, 0);
    if (isUnity) {
      gradient.addColorStop(0, 'rgba(60, 119, 180, 0.6)');
      gradient.addColorStop(0.55, flash ? '#5a9de2' : '#3c77b4');
      gradient.addColorStop(1, flash ? '#82b9f7' : '#5a9de2');
    } else {
      gradient.addColorStop(0, 'rgba(67, 232, 255, 0.55)');
      gradient.addColorStop(0.55, flash ? '#c4ff45' : '#43e8ff');
      gradient.addColorStop(1, flash ? '#f2ffbe' : '#c4ff45');
    }

    const pointAt = (index) => {
      const x = (index / (trace.length - 1)) * w;
      const y = h - (0.12 + clamp(trace[index], 0, 1) * 0.76) * h;
      return { x, y };
    };

    pulseCtx.save();
    pulseCtx.lineJoin = 'round';
    pulseCtx.lineCap = 'round';
    pulseCtx.strokeStyle = gradient;
    pulseCtx.lineWidth = flash ? 2.1 : 1.7;
    pulseCtx.shadowColor = isUnity
      ? (flash ? 'rgba(90, 157, 226, 0.6)' : 'rgba(60, 119, 180, 0.4)')
      : (flash ? 'rgba(196, 255, 69, 0.9)' : 'rgba(67, 232, 255, 0.75)');
    pulseCtx.shadowBlur = isUnity ? (flash ? 8 : 4) : (flash ? 13 : 8);

    pulseCtx.beginPath();
    let previous = pointAt(0);
    pulseCtx.moveTo(previous.x, previous.y);
    for (let i = 1; i < trace.length; i += 1) {
      const point = pointAt(i);
      const midX = (previous.x + point.x) / 2;
      const midY = (previous.y + point.y) / 2;
      pulseCtx.quadraticCurveTo(previous.x, previous.y, midX, midY);
      previous = point;
    }
    pulseCtx.lineTo(previous.x, previous.y);
    pulseCtx.stroke();

    const fill = pulseCtx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, flash ? 'rgba(196, 255, 69, 0.16)' : 'rgba(67, 232, 255, 0.14)');
    fill.addColorStop(1, 'rgba(67, 232, 255, 0)');
    pulseCtx.shadowBlur = 0;
    pulseCtx.lineTo(w, h);
    pulseCtx.lineTo(0, h);
    pulseCtx.closePath();
    pulseCtx.fillStyle = fill;
    pulseCtx.fill();

    const last = pointAt(trace.length - 1);
    pulseCtx.beginPath();
    pulseCtx.arc(last.x, last.y, flash ? 2.8 : 2.2, 0, Math.PI * 2);
    pulseCtx.fillStyle = flash ? '#eaffb0' : '#c4ff45';
    pulseCtx.shadowColor = flash ? 'rgba(196, 255, 69, 0.95)' : 'rgba(196, 255, 69, 0.7)';
    pulseCtx.shadowBlur = 10;
    pulseCtx.fill();
    pulseCtx.restore();

    const sweep = ((now / 9000) % 1) * w;
    const sweepGradient = pulseCtx.createLinearGradient(sweep - 26, 0, sweep + 26, 0);
    sweepGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    sweepGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.045)');
    sweepGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    pulseCtx.fillStyle = sweepGradient;
    pulseCtx.fillRect(sweep - 26, 0, 52, h);
  }

  function drawBreath() {
    if (!breathCtx) return;
    const { w, h } = breathSize;
    breathCtx.clearRect(0, 0, w, h);

    const trace = display.breathTrace;
    if (!trace || trace.length < 2) {
      breathCtx.strokeStyle = 'rgba(151, 185, 226, 0.2)';
      breathCtx.lineWidth = 1;
      breathCtx.beginPath();
      breathCtx.moveTo(0, h * 0.55);
      breathCtx.lineTo(w, h * 0.55);
      breathCtx.stroke();
      return;
    }

    const pointAt = (index) => ({
      x: (index / (trace.length - 1)) * w,
      y: h - (0.12 + clamp(trace[index], 0, 1) * 0.76) * h,
    });

    breathCtx.save();
    breathCtx.lineJoin = 'round';
    breathCtx.lineCap = 'round';
    breathCtx.strokeStyle = 'rgba(169, 139, 255, 0.9)';
    breathCtx.lineWidth = 1.25;
    breathCtx.shadowColor = 'rgba(169, 139, 255, 0.55)';
    breathCtx.shadowBlur = 5;

    breathCtx.beginPath();
    let previous = pointAt(0);
    breathCtx.moveTo(previous.x, previous.y);
    for (let i = 1; i < trace.length; i += 1) {
      const point = pointAt(i);
      const midX = (previous.x + point.x) / 2;
      const midY = (previous.y + point.y) / 2;
      breathCtx.quadraticCurveTo(previous.x, previous.y, midX, midY);
      previous = point;
    }
    breathCtx.lineTo(previous.x, previous.y);
    breathCtx.stroke();

    breathCtx.lineTo(w, h);
    breathCtx.lineTo(0, h);
    breathCtx.closePath();
    const fill = breathCtx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(169, 139, 255, 0.16)');
    fill.addColorStop(1, 'rgba(169, 139, 255, 0)');
    breathCtx.fillStyle = fill;
    breathCtx.fill();
    breathCtx.restore();
  }

  function paint(now) {
    const elapsed = Math.min(0.1, Math.max(0, (now - (paint.last || now)) / 1000));
    paint.last = now;

    if (Number.isFinite(target.bpm)) {
      display.bpm = display.bpm == null ? target.bpm : display.bpm + (target.bpm - display.bpm) * 0.14;
      els.bpm.textContent = String(Math.round(display.bpm));
    } else {
      display.bpm = null;
      els.bpm.textContent = '--';
    }

    if (Number.isFinite(target.breathRate)) {
      display.breathRate = display.breathRate == null
        ? target.breathRate
        : display.breathRate + (target.breathRate - display.breathRate) * 0.14;
      els.breathRate.textContent = display.breathRate.toFixed(0);
    } else {
      display.breathRate = null;
      els.breathRate.textContent = '--';
    }

    display.pulseTrace = easeTrace(display.pulseTrace, target.pulseTrace, Math.min(1, elapsed * 15 + 0.18));
    display.breathTrace = easeTrace(display.breathTrace, target.breathTrace, Math.min(1, elapsed * 15 + 0.18));

    if (display.sessionRunning) {
      const sessionSec = display.sessionSec + (performance.now() - display.sessionAt) / 1000;
      const clock = formatClock(sessionSec);
      if (clock !== lastClockText) {
        lastClockText = clock;
        els.sessionTime.textContent = clock;
      }
    } else if (lastClockText !== '00:00') {
      lastClockText = '00:00';
      els.sessionTime.textContent = '00:00';
    }

    drawPulse(now);
    drawBreath();

    window.requestAnimationFrame(paint);
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  window.addEventListener('resize', resizeCanvases);
  window.addEventListener('beforeunload', () => {
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      resizeCanvases();
      if (!ws || ws.readyState > WebSocket.OPEN) connect();
    }
  });

  resizeCanvases();
  els.hypeThreshold.style.left = '70%';
  connect();
  window.requestAnimationFrame(paint);

  // Tiny debug hook for the host app's preview pane. Read-only.
  window.clippulseOverlay = {
    get lastState() { return latest; },
    get lastStateAgeMs() { return latestAt ? performance.now() - latestAt : null; },
    get connected() { return !!ws && ws.readyState === WebSocket.OPEN; },
  };
})();
