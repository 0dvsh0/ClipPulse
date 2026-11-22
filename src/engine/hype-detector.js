'use strict';

// Deterministic hype detector. No SDK, no I/O, no LLM.
//
// Input: numeric samples at arbitrary intervals.
// Output: a 0-100 hype score plus, when the hysteresis gate opens, one clip
// object describing a [trigger - preRoll, trigger + postRoll] interval.
//
// The clock is always the sample timestamp (ms). This makes the unit tests
// fully deterministic and keeps the live path independent of wall-clock drift.

const { isValidationOk } = require('../shared/validation');

const DEFAULTS = Object.freeze({
  threshold: 70,
  sustainMs: 2500,
  cooldownMs: 30000,
  warmupMs: 20000,
  baselineWindowMs: 120000,
  minConfidence: 0.4,
  minBaselineSamples: 6,
  preRollSec: 20,
  postRollSec: 10,
  expressionBoost: false,
  slopeWindowMs: 5000,
  outlierFloorBpm: 6,
  outlierStdMultiplier: 2.5,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toFiniteOrNull(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp01(value) {
  const n = toFiniteOrNull(value);
  if (n == null) return 0;
  return clamp(n, 0, 1);
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values) {
  if (!values.length) return null;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function emptyComponents() {
  return {
    pulseDelta: 0,
    pulseSlope: 0,
    breathDeviation: 0,
    breathIrregularity: 0,
    expressionBoost: 0,
    deltaScore: 0,
    slopeScore: 0,
    breathScore: 0,
    irregularityScore: 0,
    expressionScore: 0,
  };
}

/**
 * Sharp-inhalation z-score from a normalized breathing trace.
 * Pure and exported for tests.
 */
function breathIrregularity(trace) {
  if (!Array.isArray(trace) || trace.length < 6) return 0;
  const recent = trace.slice(-40).map(Number).filter(Number.isFinite);
  if (recent.length < 6) return 0;

  const diffs = [];
  for (let i = 1; i < recent.length; i += 1) {
    diffs.push(recent[i] - recent[i - 1]);
  }
  const diffMean = mean(diffs) || 0;
  const diffStd = stddev(diffs) || 0;
  if (diffStd < 1e-9) return 0;

  const tail = diffs.slice(-12);
  const maxPositive = Math.max(0, ...tail);
  const excess = maxPositive - Math.max(0, diffMean) - 1.5 * diffStd;
  return Math.max(0, excess / diffStd);
}

function expressionBoostValue(expression) {
  if (!expression || typeof expression !== 'object') return 0;
  const strongest = Math.max(
    clamp01(expression.surprise),
    clamp01(expression.happy),
    clamp01(expression.fear),
  );
  if (strongest >= 0.6) return 12;
  if (strongest >= 0.4) return 6;
  return 0;
}

function buildReason(components, peakDelta) {
  const parts = [];
  const delta = Number.isFinite(peakDelta) ? peakDelta : components.pulseDelta;
  if (delta >= 4) parts.push(`+${delta.toFixed(1)} BPM spike`);
  if (components.pulseSlope >= 0.8) {
    parts.push(`rising ${components.pulseSlope.toFixed(1)} BPM/s`);
  }
  if (components.breathDeviation >= 3) parts.push('rapid breath');
  if (components.breathIrregularity >= 0.8) parts.push('sharp inhale');
  if (components.expressionBoost > 0) parts.push('expression burst');
  return parts.length ? parts.join(' + ') : 'sustained hype';
}

function sanitizeConfig(input = {}) {
  const out = {};
  if (!input || typeof input !== 'object') return out;

  if (Number.isFinite(input.threshold)) out.threshold = clamp(input.threshold, 1, 100);
  if (Number.isFinite(input.sustainMs)) out.sustainMs = Math.max(0, input.sustainMs);
  if (Number.isFinite(input.cooldownMs)) out.cooldownMs = Math.max(0, input.cooldownMs);
  if (Number.isFinite(input.warmupMs)) out.warmupMs = Math.max(0, input.warmupMs);
  if (Number.isFinite(input.baselineWindowMs)) {
    out.baselineWindowMs = Math.max(1000, input.baselineWindowMs);
  }
  if (Number.isFinite(input.minConfidence)) {
    out.minConfidence = clamp(input.minConfidence, 0, 1);
  }
  if (Number.isFinite(input.minBaselineSamples)) {
    out.minBaselineSamples = Math.max(1, Math.floor(input.minBaselineSamples));
  }
  if (Number.isFinite(input.preRollSec)) out.preRollSec = Math.max(0, input.preRollSec);
  if (Number.isFinite(input.postRollSec)) out.postRollSec = Math.max(0, input.postRollSec);
  if (typeof input.expressionBoost === 'boolean') out.expressionBoost = input.expressionBoost;
  if (Number.isFinite(input.slopeWindowMs)) out.slopeWindowMs = Math.max(1000, input.slopeWindowMs);
  if (Number.isFinite(input.outlierFloorBpm)) out.outlierFloorBpm = Math.max(0, input.outlierFloorBpm);
  if (Number.isFinite(input.outlierStdMultiplier)) {
    out.outlierStdMultiplier = Math.max(0, input.outlierStdMultiplier);
  }

  return out;
}

class HypeDetector {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...sanitizeConfig(options) };
    this.reset(null);
  }

  /** Clear every buffer and counter. Config is retained. */
  reset(startTimeMs = null) {
    this.startedAt = Number.isFinite(startTimeMs) ? startTimeMs : null;
    this.lastT = this.startedAt;
    this.baselineSamples = [];
    this.breathSamples = [];
    this.recentSamples = [];
    this.baseline = { bpm: null, std: null, breathRate: null };
    this.baselineReady = false;
    this.skippedWarmup = false;
    this.aboveSince = null;
    this.peakBpm = null;
    this.armed = true;
    this.lastTriggerAt = -Infinity;
    this.lastScore = 0;
    this.lastComponents = emptyComponents();
    this.lastIrregularity = 0;
    this.lastSample = null;
    this.clipSeq = 0;
  }

  start(startTimeMs) {
    this.reset(startTimeMs);
  }

  configure(partial) {
    this.config = { ...this.config, ...sanitizeConfig(partial) };
    return { ...this.config };
  }

  /** Simulator convenience: make the baseline immediately usable. */
  skipWarmup(t = this.lastT) {
    const now = Number.isFinite(t) ? t : (this.lastT ?? Date.now());
    this.startedAt = now - this.config.warmupMs;

    if (this.baselineSamples.length >= 3) {
      this.updateBaseline();
    } else {
      const bpm = this.lastSample && Number.isFinite(this.lastSample.bpm)
        ? this.lastSample.bpm
        : 74;
      const breathRate = this.lastSample && Number.isFinite(this.lastSample.breathRate)
        ? this.lastSample.breathRate
        : 14;
      this.baseline = { bpm, std: 3, breathRate };
      this.baselineSamples = Array.from({ length: 6 }, (_, i) => ({
        t: now - (5 - i) * 1000,
        bpm,
        breathRate,
      }));
      this.breathSamples = this.baselineSamples.map((s) => ({ t: s.t, br: breathRate }));
    }

    this.baselineReady = true;
    this.skippedWarmup = true;
    this.lastT = now;
    return this.getStatus(now);
  }

  /**
   * Feed one sample.
   *
   * @param {object} sample
   * @param {number} sample.t                 epoch ms
   * @param {number|null} sample.bpm
   * @param {number} [sample.confidence]      0..1
   * @param {boolean} [sample.stable]
   * @param {number} [sample.validationCode]  ValidationCode integer
   * @param {number|null} [sample.breathRate]
   * @param {number[]} [sample.breathTrace]   normalized 0..1
   * @param {object|null} [sample.expression] { surprise, happy, fear } normalized 0..1
   */
  ingest(sample = {}) {
    let t = toFiniteOrNull(sample.t);
    if (t == null) t = (this.lastT ?? Date.now());
    if (this.startedAt == null) this.startedAt = t;
    if (this.lastT != null && t < this.lastT) t = this.lastT;
    this.lastT = t;

    const bpm = toFiniteOrNull(sample.bpm);
    const confidence = clamp01(sample.confidence);
    const validationCode = Number.isInteger(sample.validationCode) ? sample.validationCode : 1;
    const stable = sample.stable === true;
    const breathRate = toFiniteOrNull(sample.breathRate);
    const breathTrace = Array.isArray(sample.breathTrace)
      ? sample.breathTrace.map(Number).filter(Number.isFinite)
      : [];

    const valid = isValidationOk(validationCode)
      && confidence >= this.config.minConfidence
      && bpm != null;

    this.lastSample = { t, bpm, confidence, validationCode, stable, breathRate };

    // ---- rolling baseline (high-confidence, valid frames only) ----
    if (valid) {
      const outlier = this.baselineReady
        && this.baseline.bpm != null
        && Math.abs(bpm - this.baseline.bpm) > Math.max(
          this.config.outlierFloorBpm,
          this.config.outlierStdMultiplier * (this.baseline.std || 0),
        );

      if (!outlier) {
        this.baselineSamples.push({ t, bpm, breathRate });
        if (breathRate != null) this.breathSamples.push({ t, br: breathRate });
      }
    }
    this.pruneBaseline(t);
    this.updateBaseline();

    // ---- recent samples for the 5 s slope ----
    if (valid) {
      this.recentSamples.push({ t, bpm });
      if (this.recentSamples.length > 200) this.recentSamples.shift();
    }
    this.pruneRecent(t);

    // ---- warm-up gate ----
    if (!this.baselineReady) {
      const warmupElapsed = (t - this.startedAt) >= this.config.warmupMs;
      const stableEnough = stable && this.baselineSamples.length >= Math.max(10, this.config.minBaselineSamples);
      if (
        this.baselineSamples.length >= this.config.minBaselineSamples
        && (warmupElapsed || stableEnough || this.config.warmupMs === 0)
      ) {
        this.baselineReady = true;
      }
    }

    // ---- composite score ----
    const components = emptyComponents();
    let score = 0;
    let irregularity = 0;

    if (this.baselineReady && valid && this.baseline.bpm != null) {
      const delta = bpm - this.baseline.bpm;
      const slope = this.computeSlope(t);
      irregularity = breathIrregularity(breathTrace);
      const breathDeviation = (
        breathRate != null && this.baseline.breathRate != null
          ? Math.abs(breathRate - this.baseline.breathRate)
          : 0
      );
      const expression = this.config.expressionBoost
        ? expressionBoostValue(sample.expression)
        : 0;

      components.pulseDelta = round(delta, 2);
      components.pulseSlope = round(slope, 2);
      components.breathDeviation = round(breathDeviation, 2);
      components.breathIrregularity = round(irregularity, 2);
      components.expressionBoost = expression;

      components.deltaScore = clamp(delta / 16, 0, 1) * 62;
      components.slopeScore = clamp(slope / 2.0, 0, 1) * 18;
      components.breathScore = clamp((breathDeviation - 1) / 7, 0, 1) * 12;
      components.irregularityScore = clamp(irregularity / 1.5, 0, 1) * 8;
      components.expressionScore = expression;

      score = clamp(
        components.deltaScore
          + components.slopeScore
          + components.breathScore
          + components.irregularityScore
          + components.expressionScore,
        0,
        100,
      );
    }

    this.lastScore = round(score, 2);
    this.lastComponents = components;
    this.lastIrregularity = round(irregularity, 2);

    // ---- hysteresis + cooldown gate ----
    const cooldownRemaining = Math.max(0, this.config.cooldownMs - (t - this.lastTriggerAt));
    let sustainedMs = 0;
    let clip = null;

    if (valid && this.baselineReady && score >= this.config.threshold) {
      if (this.aboveSince == null) {
        this.aboveSince = t;
        this.peakBpm = bpm;
      } else {
        this.peakBpm = Math.max(this.peakBpm == null ? bpm : this.peakBpm, bpm);
      }
      sustainedMs = t - this.aboveSince;
    } else {
      this.aboveSince = null;
      this.peakBpm = null;
      sustainedMs = 0;
    }

    if (score < this.config.threshold - 5) this.armed = true;

    if (
      valid
      && this.baselineReady
      && this.armed
      && this.aboveSince != null
      && sustainedMs >= this.config.sustainMs
      && cooldownRemaining <= 0
    ) {
      clip = this.trigger(t, bpm, breathRate, score, components);
    }

    return {
      score: this.lastScore,
      components: { ...components },
      clip,
      baselineReady: this.baselineReady,
      warmupRemaining: this.warmupRemaining(t),
      cooldownRemaining,
      sustainedMs,
      armed: this.armed,
      threshold: this.config.threshold,
    };
  }

  trigger(t, bpm, breathRate, score, components) {
    this.clipSeq += 1;
    const peakBpm = this.peakBpm == null ? bpm : this.peakBpm;
    const baselineBpm = this.baseline.bpm == null ? peakBpm : this.baseline.bpm;
    const deltaBpm = peakBpm - baselineBpm;
    const startMs = t - this.config.preRollSec * 1000;
    const endMs = t + this.config.postRollSec * 1000;
    const reason = buildReason(components, deltaBpm);

    const clip = {
      id: `clip-${String(this.clipSeq).padStart(3, '0')}`,
      index: this.clipSeq,
      triggerAtMs: t,
      startMs,
      endMs,
      startSec: Math.max(0, round((startMs - this.startedAt) / 1000, 2)),
      endSec: Math.max(0, round((endMs - this.startedAt) / 1000, 2)),
      peakBpm: round(peakBpm, 1),
      baselineBpm: round(baselineBpm, 1),
      deltaBpm: round(deltaBpm, 1),
      breathRate: breathRate == null ? null : round(breathRate, 1),
      hypeScore: Math.round(score),
      confidence: this.lastSample ? round(this.lastSample.confidence, 2) : null,
      reason,
      preRollSec: this.config.preRollSec,
      postRollSec: this.config.postRollSec,
    };

    this.lastTriggerAt = t;
    this.aboveSince = null;
    this.peakBpm = null;
    this.armed = false;

    return clip;
  }

  computeSlope(t) {
    const cutoff = t - this.config.slopeWindowMs;
    const window = this.recentSamples.filter((s) => s.t >= cutoff);
    if (window.length < 3) return 0;

    const span = (window[window.length - 1].t - window[0].t) / 1000;
    if (span < 1) return 0;

    const t0 = window[0].t;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (const sample of window) {
      const x = (sample.t - t0) / 1000;
      sumX += x;
      sumY += sample.bpm;
      sumXY += x * sample.bpm;
      sumXX += x * x;
    }
    const n = window.length;
    const denominator = n * sumXX - sumX * sumX;
    if (Math.abs(denominator) < 1e-9) return 0;
    return (n * sumXY - sumX * sumY) / denominator;
  }

  updateBaseline() {
    if (this.baselineSamples.length === 0) {
      this.baseline = { bpm: null, std: null, breathRate: null };
      return;
    }
    const bpms = this.baselineSamples.map((s) => s.bpm);
    const breaths = this.breathSamples.map((s) => s.br);
    this.baseline = {
      bpm: round(mean(bpms), 2),
      std: round(stddev(bpms), 2),
      breathRate: breaths.length ? round(mean(breaths), 2) : null,
    };
  }

  pruneBaseline(t) {
    const cutoff = t - this.config.baselineWindowMs;
    while (this.baselineSamples.length && this.baselineSamples[0].t < cutoff) {
      this.baselineSamples.shift();
    }
    while (this.breathSamples.length && this.breathSamples[0].t < cutoff) {
      this.breathSamples.shift();
    }
  }

  pruneRecent(t) {
    const cutoff = t - this.config.slopeWindowMs - 1000;
    while (this.recentSamples.length && this.recentSamples[0].t < cutoff) {
      this.recentSamples.shift();
    }
  }

  warmupRemaining(t = this.lastT) {
    if (this.baselineReady) return 0;
    if (this.startedAt == null) return this.config.warmupMs;
    return Math.max(0, this.config.warmupMs - (t - this.startedAt));
  }

  getStatus(t = this.lastT) {
    const now = Number.isFinite(t) ? t : (this.lastT ?? Date.now());
    const sustainedMs = this.aboveSince == null ? 0 : Math.max(0, now - this.aboveSince);
    return {
      baseline: { ...this.baseline },
      baselineReady: this.baselineReady,
      skippedWarmup: this.skippedWarmup,
      warmupRemaining: this.warmupRemaining(now),
      cooldownRemaining: Math.max(0, this.config.cooldownMs - (now - this.lastTriggerAt)),
      sustainedMs,
      score: this.lastScore,
      components: { ...this.lastComponents },
      armed: this.armed,
      threshold: this.config.threshold,
      startedAt: this.startedAt,
      clipCount: this.clipSeq,
    };
  }
}

module.exports = {
  HypeDetector,
  DEFAULTS,
  breathIrregularity,
  buildReason,
  expressionBoostValue,
  mean,
  stddev,
  clamp,
  round,
};
