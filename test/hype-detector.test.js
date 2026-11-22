'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HypeDetector,
  breathIrregularity,
  expressionBoostValue,
} = require('../src/engine/hype-detector');

// Every test drives the detector with explicit timestamps, so the whole file
// is deterministic and never waits on a real clock.

function makeDetector(overrides = {}) {
  return new HypeDetector({
    warmupMs: 0,
    threshold: 70,
    sustainMs: 2500,
    cooldownMs: 30000,
    ...overrides,
  });
}

function feed(detector, t, bpm, extra = {}) {
  return detector.ingest({
    t,
    bpm,
    confidence: 0.9,
    stable: true,
    validationCode: 0,
    breathRate: 14,
    ...extra,
  });
}

/** Constant baseline at 1 Hz. */
function primeBaseline(detector, { from = 0, to = 5000, bpm = 70, breathRate = 14 } = {}) {
  let last = null;
  for (let t = from; t <= to; t += 1000) {
    last = feed(detector, t, bpm, { breathRate });
  }
  return last;
}

/** Hold a steady reading for a range at 1 Hz. */
function hold(detector, { from, to, bpm, breathRate = 14, extra = {} }) {
  const results = [];
  for (let t = from; t <= to; t += 1000) {
    results.push(feed(detector, t, bpm, { breathRate, ...extra }));
  }
  return results;
}

test('baseline mean and deviation match the sample window', () => {
  const detector = makeDetector();
  const bpms = [60, 62, 64, 66, 68, 70];
  let result = null;

  bpms.forEach((bpm, i) => {
    result = feed(detector, i * 1000, bpm);
  });

  assert.equal(result.baselineReady, true);
  assert.equal(detector.baseline.bpm, 65);
  assert.equal(detector.baseline.std, 3.42);
  assert.equal(detector.baseline.breathRate, 14);
});

test('warm-up gate waits for the configured window when samples are not stable', () => {
  const detector = makeDetector({ warmupMs: 20000 });

  let result = null;
  for (let t = 0; t <= 19000; t += 1000) {
    result = feed(detector, t, 70, { stable: false });
  }
  assert.equal(result.baselineReady, false);
  assert.equal(result.warmupRemaining, 1000);

  result = feed(detector, 20000, 70, { stable: false });
  assert.equal(result.baselineReady, true);
  assert.equal(result.warmupRemaining, 0);
});

test('a spike shorter than the sustain window never triggers a clip', () => {
  const detector = makeDetector();
  primeBaseline(detector);

  const spike = feed(detector, 6000, 90, { breathRate: 24 });
  assert.equal(spike.clip, null);
  assert.ok(spike.score >= 70, 'spike should score above threshold');
  assert.equal(spike.sustainedMs, 0);

  const back = feed(detector, 7000, 70, { breathRate: 14 });
  assert.equal(back.clip, null);
  assert.equal(back.sustainedMs, 0);

  hold(detector, { from: 8000, to: 12000, bpm: 70 });
  assert.equal(detector.getStatus(12000).clipCount, 0);
});

test('sustained spike triggers exactly one clip with the rolling window', () => {
  const detector = makeDetector();
  hold(detector, { from: 0, to: 25000, bpm: 70 });

  const early = hold(detector, { from: 26000, to: 28000, bpm: 90, breathRate: 24 });
  for (const result of early) {
    assert.equal(result.clip, null, 'clip must wait for the 2.5 s sustain window');
  }

  const result = feed(detector, 29000, 90, { breathRate: 24 });
  assert.ok(result.clip, 'clip should trigger at 3 s of sustained hype');

  const clip = result.clip;
  assert.equal(clip.id, 'clip-001');
  assert.equal(clip.index, 1);
  assert.equal(clip.triggerAtMs, 29000);
  assert.equal(clip.peakBpm, 90);
  assert.equal(clip.baselineBpm, 70);
  assert.equal(clip.deltaBpm, 20);
  assert.equal(clip.hypeScore, 92);
  assert.equal(clip.preRollSec, 20);
  assert.equal(clip.postRollSec, 10);
  assert.equal(clip.startSec, 9);
  assert.equal(clip.endSec, 39);
  assert.match(clip.reason, /\+20\.0 BPM spike/);
  assert.equal(result.sustainedMs, 3000, 'trigger reports the sustain span that fired');

  const after = hold(detector, { from: 30000, to: 32000, bpm: 90, breathRate: 24 });
  assert.equal(after[0].sustainedMs, 0, 'sustain counter resets after a trigger');
  for (const next of after) {
    assert.equal(next.clip, null, 'cooldown must suppress a second clip');
  }
  assert.equal(detector.getStatus(32000).clipCount, 1);
});

test('cooldown expires and a fresh sustained spike triggers again', () => {
  const detector = makeDetector({ cooldownMs: 10000 });
  primeBaseline(detector);

  const first = hold(detector, { from: 6000, to: 9000, bpm: 90, breathRate: 24 });
  assert.ok(first[first.length - 1].clip, 'first spike should trigger');

  hold(detector, { from: 10000, to: 18000, bpm: 70, breathRate: 14 });

  const second = hold(detector, { from: 20000, to: 23000, bpm: 90, breathRate: 24 });
  assert.equal(second[0].clip, null);
  assert.equal(second[1].clip, null);
  assert.equal(second[2].clip, null);
  assert.ok(second[3].clip, 'second spike should trigger after cooldown');
  assert.equal(second[3].clip.triggerAtMs, 23000);
  assert.equal(detector.getStatus(23000).clipCount, 2);
});

test('low-confidence samples are ignored for scoring and baseline', () => {
  const detector = makeDetector({ minConfidence: 0.4 });
  primeBaseline(detector);

  const results = hold(detector, {
    from: 6000,
    to: 12000,
    bpm: 95,
    breathRate: 26,
    extra: { confidence: 0.2 },
  });

  for (const result of results) {
    assert.equal(result.score, 0);
    assert.equal(result.clip, null);
  }
  assert.equal(detector.baseline.bpm, 70);
  assert.equal(detector.getStatus(12000).clipCount, 0);
});

test('invalid validation codes block scoring even with a high reading', () => {
  const detector = makeDetector();
  primeBaseline(detector);

  const results = hold(detector, {
    from: 6000,
    to: 12000,
    bpm: 95,
    breathRate: 26,
    extra: { validationCode: 1 },
  });

  for (const result of results) {
    assert.equal(result.score, 0);
    assert.equal(result.clip, null);
  }
  assert.equal(detector.getStatus(12000).clipCount, 0);
});

test('outlier readings are rejected by the rolling baseline', () => {
  const detector = makeDetector();
  primeBaseline(detector);

  feed(detector, 6000, 90, { breathRate: 24 });
  feed(detector, 7000, 70);

  assert.equal(detector.baseline.bpm, 70);
  for (const sample of detector.baselineSamples) {
    assert.equal(sample.bpm, 70, 'the rejected spike must not enter the baseline');
  }
});

test('expression boost adds its weight only when enabled', () => {
  const boosted = makeDetector({ expressionBoost: true });
  primeBaseline(boosted);
  const withBoost = feed(boosted, 6000, 90, {
    breathRate: 14,
    expression: { surprise: 0.8, happy: 0, fear: 0 },
  });
  assert.equal(withBoost.components.expressionBoost, 12);
  assert.equal(withBoost.score, 92);

  const plain = makeDetector({ expressionBoost: false });
  primeBaseline(plain);
  const withoutBoost = feed(plain, 6000, 90, {
    breathRate: 14,
    expression: { surprise: 0.8, happy: 0, fear: 0 },
  });
  assert.equal(withoutBoost.components.expressionBoost, 0);
  assert.equal(withoutBoost.score, 80);
});

test('expressionBoostValue picks the strongest expression tier', () => {
  assert.equal(expressionBoostValue(null), 0);
  assert.equal(expressionBoostValue({ surprise: 0.1 }), 0);
  assert.equal(expressionBoostValue({ happy: 0.45 }), 6);
  assert.equal(expressionBoostValue({ fear: 0.75 }), 12);
  assert.equal(expressionBoostValue({ surprise: 0.5, happy: 0.7, fear: 0.2 }), 12);
});

test('skipWarmup primes the baseline so a spike can trigger immediately', () => {
  const detector = makeDetector({ warmupMs: 20000 });
  feed(detector, 0, 70, { stable: false });
  const before = feed(detector, 1000, 70, { stable: false });
  assert.equal(before.baselineReady, false);

  const status = detector.skipWarmup(5000);
  assert.equal(status.baselineReady, true);
  assert.equal(status.warmupRemaining, 0);
  assert.equal(detector.baseline.bpm, 70);
  assert.equal(detector.baselineSamples.length, 6);

  const results = hold(detector, { from: 6000, to: 9000, bpm: 90, breathRate: 24 });
  assert.ok(results[results.length - 1].clip, 'primed detector should clip after sustain');
});

test('baseline window prunes old samples', () => {
  const detector = makeDetector({ baselineWindowMs: 10000 });
  hold(detector, { from: 0, to: 20000, bpm: 70 });

  assert.equal(detector.baselineSamples.length, 11);
  assert.equal(detector.baselineSamples[0].t, 10000);
  assert.equal(detector.baselineSamples[detector.baselineSamples.length - 1].t, 20000);
});

test('breathIrregularity responds to a sharp rise and ignores flat traces', () => {
  assert.equal(breathIrregularity(null), 0);
  assert.equal(breathIrregularity([0.1, 0.2]), 0);

  const flat = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  assert.equal(breathIrregularity(flat), 0);

  const jagged = [0.1, 0.12, 0.1, 0.12, 0.1, 0.12, 0.1, 0.12, 0.5];
  assert.ok(breathIrregularity(jagged) > 0.5);
});

test('timestamps never move backwards', () => {
  const detector = makeDetector();
  primeBaseline(detector);

  const result = feed(detector, 1000, 71);
  assert.equal(detector.lastT, 5000);
  assert.ok(result);
});

test('reset clears every counter and buffer', () => {
  const detector = makeDetector();
  hold(detector, { from: 0, to: 25000, bpm: 70 });
  hold(detector, { from: 26000, to: 29000, bpm: 90, breathRate: 24 });
  assert.equal(detector.getStatus(29000).clipCount, 1);

  detector.reset(100000);
  const status = detector.getStatus(100000);
  assert.equal(status.clipCount, 0);
  assert.equal(status.baselineReady, false);
  assert.equal(status.score, 0);
  assert.equal(detector.baselineSamples.length, 0);
  assert.equal(detector.breathSamples.length, 0);
  assert.equal(detector.recentSamples.length, 0);
});

test('null and non-numeric bpm samples produce zero score safely', () => {
  const detector = makeDetector();
  primeBaseline(detector);

  const res1 = feed(detector, 6000, null);
  assert.equal(res1.score, 0);
  assert.equal(res1.clip, null);

  const res2 = feed(detector, 7000, NaN);
  assert.equal(res2.score, 0);
  assert.equal(res2.clip, null);
});

test('outlier threshold scales with baseline standard deviation', () => {
  const detector = makeDetector();
  // Build a baseline with larger spread: std roughly 4
  const bpms = [66, 74, 66, 74, 66, 74];
  bpms.forEach((bpm, i) => {
    feed(detector, i * 1000, bpm);
  });

  assert.equal(detector.baselineReady, true);
  assert.equal(detector.baseline.bpm, 70);
  assert.ok(detector.baseline.std >= 3.8);

  // 2.5 * 4 = 10; delta 8 should enter baseline, delta 15 should be rejected
  feed(detector, 7000, 78);
  const acceptedSample = detector.baselineSamples.find((s) => s.t === 7000);
  assert.ok(acceptedSample, 'sample within 2.5 sigma should enter baseline');

  feed(detector, 8000, 86);
  const rejectedSample = detector.baselineSamples.find((s) => s.t === 8000);
  assert.equal(rejectedSample, undefined, 'sample beyond 2.5 sigma should be rejected');
});
