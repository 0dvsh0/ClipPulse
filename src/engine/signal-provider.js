'use strict';

// Renderer-side signal provider. Owns exactly one SDK instance in LIVE mode
// or a synthetic generator in SIMULATOR mode, normalizes everything into the
// small numeric frame contract, and never forwards raw video.

const {
  SmartSpectraSDK,
  ProcessingStatus,
  ValidationCode,
  breathingMetrics,
  cardioMetrics,
  faceMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const { validationLabel } = require('../shared/validation');

const EMIT_INTERVAL_MS = 90;
const MAX_PULSE_POINTS = 160;
const MAX_BREATH_POINTS = 80;
const TRACE_WINDOW_MS = 20000;

const STATUS_LABELS = Object.freeze({
  [ProcessingStatus.kUninitialized]: 'UNINITIALIZED',
  [ProcessingStatus.kIdle]: 'IDLE',
  [ProcessingStatus.kStarting]: 'STARTING',
  [ProcessingStatus.kRunning]: 'RUNNING',
  [ProcessingStatus.kStopping]: 'STOPPING',
  [ProcessingStatus.kError]: 'ERROR',
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 0;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function tsToNumber(ts) {
  if (ts == null) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'bigint') return Number(ts);
  if (typeof ts.toNumber === 'function') return ts.toNumber();
  return Number(ts);
}

function normalizeTrace(values, maxPoints) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length === 0) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const v of clean) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const points = range < 1e-9
    ? clean.map(() => 0.5)
    : clean.map((v) => (v - min) / range);

  return points.slice(-maxPoints).map((v) => Math.round(v * 1000) / 1000);
}

function ecgSample(phase) {
  const g = (center, width) => Math.exp(-((phase - center) ** 2) / (2 * width * width));
  return (
    0.12 * g(0.12, 0.035)
    - 0.18 * g(0.20, 0.015)
    + 1.00 * g(0.27, 0.012)
    - 0.30 * g(0.36, 0.022)
    + 0.22 * g(0.52, 0.070)
  );
}

function envelope(now, start, riseMs, holdMs, fallMs) {
  const elapsed = now - start;
  if (elapsed < 0) return 0;
  if (elapsed < riseMs) return elapsed / riseMs;
  if (elapsed < riseMs + holdMs) return 1;
  if (elapsed < riseMs + holdMs + fallMs) {
    return 1 - (elapsed - riseMs - holdMs) / fallMs;
  }
  return 0;
}

class SignalProvider {
  constructor({
    mode,
    apiKey = '',
    expressionBoost = false,
    onFrame = () => {},
    onEvent = () => {},
    onPreviewStream = () => {},
    onError = () => {},
  } = {}) {
    this.mode = mode === 'simulator' ? 'simulator' : 'live';
    this.apiKey = apiKey;
    this.expressionBoost = expressionBoost === true;
    this.onFrame = onFrame;
    this.onEvent = onEvent;
    this.onPreviewStream = onPreviewStream;
    this.onError = onError;

    this.sdk = null;
    this.simTimer = null;
    this.emitTimer = null;
    this.stopped = false;

    this.sessionStartMs = Date.now();
    this.metricsCount = 0;
    this.frameTimes = [];
    this.lastEmitMs = 0;

    this.bpm = null;
    this.breathRate = null;
    this.confidence = 0;
    this.stable = false;
    this.validationCode = ValidationCode.kCameraTuning;
    this.validationHint = '';
    this.expression = null;
    this.pulseBuffer = [];
    this.breathBuffer = [];
    this.pulseTrace = [];
    this.breathTrace = [];
    this.sim = null;
  }

  async start() {
    this.sessionStartMs = Date.now();
    this.stopped = false;
    if (this.mode === 'simulator') {
      this.startSimulator();
      return;
    }
    await this.startLive();
  }

  async startLive() {
    if (!this.apiKey) {
      throw new Error('No SmartSpectra API key configured.');
    }

    const requestedMetrics = [
      ...breathingMetrics,
      ...cardioMetrics,
      ...(this.expressionBoost ? faceMetrics : []),
    ];

    const sdk = new SmartSpectraSDK({
      apiKey: this.apiKey,
      requestedMetrics,
      enableAccumulatedOutput: false,
      enableTelemetry: false,
    });
    this.sdk = sdk;

    // Exactly one listener per event. The SDK replaces duplicate listeners,
    // so all fan-out happens inside this provider.
    sdk.on('streamAvailable', (stream) => {
      this.onPreviewStream(stream);
      this.emitEvent({ kind: 'stream', text: 'Camera stream acquired by SmartSpectra.' });
    });

    sdk.on('processingStatus', (status) => {
      this.emitEvent({
        kind: 'status',
        status,
        text: `SDK ${STATUS_LABELS[status] || status}`,
      });
    });

    sdk.on('validationStatus', (code, timestampUs, hint) => {
      this.validationCode = code;
      this.validationHint = hint || '';
      this.emitEvent({
        kind: 'validation',
        code,
        label: validationLabel(code),
        hint: this.validationHint,
        timestampUs,
        text: `Validation ${code} ${validationLabel(code)}`,
      });
      this.emitFrame(true);
    });

    sdk.on('metrics', (buf, timestampUs) => {
      this.metricsCount += 1;
      try {
        const metrics = decodeMetrics(buf);
        this.handleMetrics(metrics, timestampUs);
      } catch (err) {
        this.emitEvent({
          kind: 'decode-error',
          text: `Metrics decode failed: ${err && err.message ? err.message : err}`,
        });
      }
    });

    sdk.on('frameSentThrough', (sent) => {
      if (!sent) return;
      const now = Date.now();
      this.frameTimes.push(now);
      const cutoff = now - 2000;
      while (this.frameTimes.length && this.frameTimes[0] < cutoff) this.frameTimes.shift();
    });

    sdk.on('error', (code, message, retryable) => {
      const event = { kind: 'error', code, message, retryable, text: `SDK error ${code}: ${message}` };
      this.emitEvent(event);
      this.onError(event);
    });

    try {
      await sdk.start();
      this.emitEvent({ kind: 'status', text: 'LIVE session started.' });
    } catch (err) {
      this.emitEvent({
        kind: 'error',
        code: err && err.code,
        message: err && err.message ? err.message : String(err),
        retryable: !!(err && err.retryable),
        text: `Live start failed: ${err && err.message ? err.message : err}`,
      });
      try { sdk.destroy(); } catch { /* ignore */ }
      this.sdk = null;
      throw err;
    }
  }

  handleMetrics(metrics, timestampUs) {
    const now = Date.now();
    const pulseArr = (metrics && metrics.cardio && metrics.cardio.pulseRate) || [];
    const latestPulse = pulseArr.length ? pulseArr[pulseArr.length - 1] : null;
    if (latestPulse && Number.isFinite(latestPulse.value)) {
      this.bpm = latestPulse.value;
      this.confidence = clamp01((latestPulse.confidence == null ? 0 : latestPulse.confidence) / 100);
      this.stable = latestPulse.stable === true;
    }

    const pressureTrace = (metrics && metrics.cardio && metrics.cardio.arterialPressureTrace) || [];
    for (const point of pressureTrace) {
      if (!point || !Number.isFinite(point.value)) continue;
      const rawTs = tsToNumber(point.timestamp);
      const tMs = rawTs > 0 ? rawTs / 1000 : now;
      const t = (tMs >= now - TRACE_WINDOW_MS && tMs <= now + 5000) ? tMs : now;
      this.pulseBuffer.push({ t, v: point.value });
    }

    const rateArr = (metrics && metrics.breathing && metrics.breathing.rate) || [];
    const latestRate = rateArr.length ? rateArr[rateArr.length - 1] : null;
    if (latestRate && Number.isFinite(latestRate.value)) {
      this.breathRate = latestRate.value;
    }

    const upperTrace = (metrics && metrics.breathing && metrics.breathing.upperTrace) || [];
    for (const point of upperTrace) {
      if (!point || !Number.isFinite(point.value)) continue;
      const rawTs = tsToNumber(point.timestamp);
      const tMs = rawTs > 0 ? rawTs / 1000 : now;
      const t = (tMs >= now - TRACE_WINDOW_MS && tMs <= now + 5000) ? tMs : now;
      this.breathBuffer.push({ t, v: point.value });
    }

    if (this.expressionBoost) {
      const expressions = (metrics && metrics.face && metrics.face.expression) || [];
      const latest = expressions.length ? expressions[expressions.length - 1] : null;
      if (latest && Array.isArray(latest.scores)) {
        const find = (type) => {
          const score = latest.scores.find((s) => s && s.type === type);
          return score ? clamp01((score.confidence == null ? 0 : score.confidence) / 100) : 0;
        };
        this.expression = {
          surprise: round(find(8), 2),
          happy: round(find(5), 2),
          fear: round(find(4), 2),
        };
      }
    }

    this.pruneBuffers(now);
    this.pulseTrace = normalizeTrace(this.pulseBuffer.map((p) => p.v), MAX_PULSE_POINTS);
    this.breathTrace = normalizeTrace(this.breathBuffer.map((p) => p.v), MAX_BREATH_POINTS);

    this.emitFrame(false);
    void timestampUs;
  }

  pruneBuffers(now) {
    const cutoff = now - TRACE_WINDOW_MS;
    while (this.pulseBuffer.length && this.pulseBuffer[0].t < cutoff) this.pulseBuffer.shift();
    while (this.breathBuffer.length && this.breathBuffer[0].t < cutoff) this.breathBuffer.shift();
    if (this.pulseBuffer.length > 600) this.pulseBuffer.splice(0, this.pulseBuffer.length - 600);
    if (this.breathBuffer.length > 400) this.breathBuffer.splice(0, this.breathBuffer.length - 400);
  }

  computeFps() {
    if (this.mode === 'simulator') return 30;
    const now = Date.now();
    const cutoff = now - 2000;
    while (this.frameTimes.length && this.frameTimes[0] < cutoff) this.frameTimes.shift();
    if (this.frameTimes.length < 2) return 0;
    const span = Math.max(1, (now - this.frameTimes[0]) / 1000);
    return round(this.frameTimes.length / span, 1);
  }

  emitFrame(force) {
    if (this.stopped) return;
    const now = Date.now();
    const elapsed = now - this.lastEmitMs;
    if (!force && elapsed < EMIT_INTERVAL_MS) {
      if (!this.emitTimer) {
        this.emitTimer = setTimeout(() => {
          this.emitTimer = null;
          this.emitFrame(true);
        }, Math.max(10, EMIT_INTERVAL_MS - elapsed));
      }
      return;
    }
    this.lastEmitMs = now;

    this.onFrame({
      t: now,
      mode: this.mode,
      bpm: round(this.bpm, 1),
      breathRate: round(this.breathRate, 1),
      confidence: round(this.confidence, 2),
      stable: this.stable,
      validationCode: this.validationCode,
      validationState: validationLabel(this.validationCode),
      validationHint: this.validationHint,
      packetCount: this.metricsCount,
      fps: this.computeFps(),
      pulseTrace: this.pulseTrace,
      breathTrace: this.breathTrace,
      expression: this.expression,
    });
  }

  emitEvent(event) {
    this.onEvent({ t: Date.now(), ...event });
  }

  // ---------------------------------------------------------------------
  // Simulator
  // ---------------------------------------------------------------------

  startSimulator() {
    this.sim = {
      startedAt: Date.now(),
      lastTick: Date.now(),
      phase: 0,
      spikeStart: 0,
      spikeUntil: 0,
      gaspStart: 0,
      gaspUntil: 0,
      leanUntil: 0,
    };
    this.validationCode = ValidationCode.kOk;
    this.validationHint = '';
    this.confidence = 0.92;
    this.stable = true;
    this.bpm = 74;
    this.breathRate = 14;
    this.emitEvent({ kind: 'status', text: 'SIMULATOR session started — no live camera.' });
    this.tickSimulator();
    this.simTimer = setInterval(() => this.tickSimulator(), 100);
  }

  tickSimulator() {
    if (this.stopped || !this.sim) return;
    const now = Date.now();
    const dt = Math.max(1, now - this.sim.lastTick);
    this.sim.lastTick = now;

    const t = (now - this.sim.startedAt) / 1000;
    const noise = (Math.random() - 0.5) * 1.2;
    let bpm = 74 + Math.sin(t / 9) * 1.6 + noise;

    const spike = envelope(now, this.sim.spikeStart, 2500, 4000, 3000);
    if (spike > 0) bpm += 18 * spike;

    const gasp = envelope(now, this.sim.gaspStart, 700, 1400, 2600);
    let breathRate = 14 + Math.sin(t / 6) * 0.8 + (Math.random() - 0.5) * 0.4;
    if (spike > 0) breathRate += 4.5 * spike;
    if (gasp > 0) breathRate += 7 * gasp;

    const leaning = now < this.sim.leanUntil;
    if (leaning) {
      this.validationCode = ValidationCode.kNoFaceFound;
      this.validationHint = 'Face not detected — step back into frame.';
      this.confidence = 0;
      this.stable = false;
    } else {
      this.validationCode = ValidationCode.kOk;
      this.validationHint = '';
      this.confidence = clamp01(0.92 + (Math.random() - 0.5) * 0.03);
      this.stable = true;
    }

    this.bpm = bpm;
    this.breathRate = breathRate;
    this.metricsCount += 1;

    this.sim.phase = (this.sim.phase + (dt / 1000) * (bpm / 60)) % 1;
    const pulse = [];
    for (let i = 0; i < MAX_PULSE_POINTS; i += 1) {
      const phase = (this.sim.phase + (i / MAX_PULSE_POINTS) * 3) % 1;
      pulse.push(ecgSample(phase) + (Math.random() - 0.5) * 0.035);
    }

    const breath = [];
    for (let i = 0; i < MAX_BREATH_POINTS; i += 1) {
      const phase = ((now - this.sim.startedAt) / 4200 + i / MAX_BREATH_POINTS * 2) % 1;
      let value = 0.5 + 0.32 * Math.sin(phase * Math.PI * 2);
      if (gasp > 0) {
        value += 0.45 * gasp * Math.exp(-((i - MAX_BREATH_POINTS + 8) ** 2) / 18);
      }
      breath.push(value + (Math.random() - 0.5) * 0.015);
    }

    this.pulseTrace = normalizeTrace(pulse, MAX_PULSE_POINTS);
    this.breathTrace = normalizeTrace(breath, MAX_BREATH_POINTS);

    if (this.expressionBoost) {
      this.expression = {
        surprise: spike > 0.4 ? round(0.55 + 0.35 * spike, 2) : 0.08,
        happy: 0.18,
        fear: gasp > 0.5 ? 0.62 : 0.05,
      };
    } else {
      this.expression = null;
    }

    this.emitFrame(true);
  }

  triggerSpike() {
    if (!this.sim) return;
    const now = Date.now();
    this.sim.spikeStart = now;
    this.sim.spikeUntil = now + 9500;
    this.emitEvent({ kind: 'sim', text: 'Simulator: boss-fight spike injected (+18 BPM).' });
  }

  triggerGasp() {
    if (!this.sim) return;
    const now = Date.now();
    this.sim.gaspStart = now;
    this.sim.gaspUntil = now + 5200;
    this.emitEvent({ kind: 'sim', text: 'Simulator: gasp / surprise injected.' });
  }

  triggerLean() {
    if (!this.sim) return;
    const now = Date.now();
    this.sim.leanUntil = now + 4200;
    this.emitEvent({ kind: 'sim', text: 'Simulator: lean-away / validation lost.' });
  }

  resetSimulator() {
    if (!this.sim) return;
    this.sim.spikeStart = 0;
    this.sim.spikeUntil = 0;
    this.sim.gaspStart = 0;
    this.sim.gaspUntil = 0;
    this.sim.leanUntil = 0;
    this.emitEvent({ kind: 'sim', text: 'Simulator reset to baseline.' });
  }

  async stop() {
    this.stopped = true;

    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }

    if (this.sdk) {
      const sdk = this.sdk;
      this.sdk = null;
      try {
        await sdk.stop();
      } catch (err) {
        this.emitEvent({
          kind: 'error',
          text: `SDK stop failed: ${err && err.message ? err.message : err}`,
        });
      }
      try { sdk.destroy(); } catch { /* ignore */ }
    }

    this.onPreviewStream(null);
    this.clearBuffers();
    this.emitEvent({ kind: 'status', text: 'Session stopped. Buffers cleared.' });
  }

  clearBuffers() {
    this.bpm = null;
    this.breathRate = null;
    this.confidence = 0;
    this.stable = false;
    this.validationCode = ValidationCode.kCameraTuning;
    this.validationHint = '';
    this.expression = null;
    this.pulseBuffer = [];
    this.breathBuffer = [];
    this.pulseTrace = [];
    this.breathTrace = [];
    this.frameTimes = [];
    this.metricsCount = 0;
    this.sim = null;
  }
}

module.exports = {
  SignalProvider,
  normalizeTrace,
  ecgSample,
  envelope,
  clamp01,
  round,
};
