'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SignalProvider,
  normalizeTrace,
  ecgSample,
  envelope,
  clamp01,
  round,
} = require('../src/engine/signal-provider');

test('clamp01 bounds values between 0 and 1', () => {
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(1.8), 1);
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(null), 0);
  assert.equal(clamp01('0.75'), 0.75);
});

test('round produces expected decimal precision', () => {
  assert.equal(round(12.3456, 1), 12.3);
  assert.equal(round(12.3456, 2), 12.35);
  assert.equal(round(12.3456, 0), 12);
  assert.equal(round(NaN, 1), null);
  assert.equal(round(Infinity, 1), null);
});

test('normalizeTrace handles empty and flat input safely', () => {
  assert.deepEqual(normalizeTrace([], 100), []);
  assert.deepEqual(normalizeTrace(null, 100), []);
  assert.deepEqual(normalizeTrace(['a', 'b'], 100), []);

  const flat = [5, 5, 5, 5];
  const normalizedFlat = normalizeTrace(flat, 100);
  assert.equal(normalizedFlat.length, 4);
  assert.deepEqual(normalizedFlat, [0.5, 0.5, 0.5, 0.5]);
});

test('normalizeTrace normalizes values across full 0 to 1 range and respects maxPoints', () => {
  const points = [10, 20, 30, 40, 50];
  const normalized = normalizeTrace(points, 3);
  assert.equal(normalized.length, 3);
  // Last 3 points: 30 (0.5), 40 (0.75), 50 (1.0)
  assert.equal(normalized[0], 0.5);
  assert.equal(normalized[1], 0.75);
  assert.equal(normalized[2], 1.0);
});

test('ecgSample returns finite values across all phases', () => {
  for (let phase = 0; phase <= 1.0; phase += 0.05) {
    const sample = ecgSample(phase);
    assert.ok(Number.isFinite(sample), `ecg sample at phase ${phase} must be finite`);
  }
});

test('envelope computes correct ramp, hold, and release progression', () => {
  const start = 1000;
  const rise = 1000;
  const hold = 2000;
  const fall = 1000;

  assert.equal(envelope(900, start, rise, hold, fall), 0);
  assert.equal(envelope(1500, start, rise, hold, fall), 0.5);
  assert.equal(envelope(2000, start, rise, hold, fall), 1.0);
  assert.equal(envelope(3000, start, rise, hold, fall), 1.0);
  assert.equal(envelope(4500, start, rise, hold, fall), 0.5);
  assert.equal(envelope(5500, start, rise, hold, fall), 0);
});

test('simulator signal provider generates frames and responds to demo triggers', async () => {
  const frames = [];
  const events = [];

  const provider = new SignalProvider({
    mode: 'simulator',
    onFrame: (f) => frames.push(f),
    onEvent: (e) => events.push(e),
  });

  await provider.start();
  assert.ok(frames.length > 0, 'simulator should emit at least one immediate frame');
  assert.equal(frames[0].mode, 'simulator');
  assert.equal(frames[0].validationCode, 0);

  // Test spike injection
  provider.triggerSpike();
  assert.ok(provider.sim.spikeStart > 0);

  // Test gasp injection
  provider.triggerGasp();
  assert.ok(provider.sim.gaspStart > 0);

  // Test lean-away injection
  provider.triggerLean();
  assert.ok(provider.sim.leanUntil > 0);

  // Test reset
  provider.resetSimulator();
  assert.equal(provider.sim.spikeStart, 0);
  assert.equal(provider.sim.gaspStart, 0);
  assert.equal(provider.sim.leanUntil, 0);

  // Stop provider
  await provider.stop();
  assert.equal(provider.stopped, true);
  assert.equal(provider.bpm, null);
  assert.equal(provider.sim, null);
});

test('startLive rejects immediately if API key is missing', async () => {
  const provider = new SignalProvider({ mode: 'live', apiKey: '' });
  await assert.rejects(
    () => provider.start(),
    /No SmartSpectra API key configured/,
  );
});

test('handleMetrics decodes cardio, breathing, and expression metrics correctly', () => {
  const frames = [];
  const provider = new SignalProvider({
    mode: 'live',
    expressionBoost: true,
    onFrame: (f) => frames.push(f),
  });

  const mockMetrics = {
    cardio: {
      pulseRate: [{ value: 78.5, confidence: 92, stable: true }],
      arterialPressureTrace: [
        { value: 1.2, timestamp: 1_000_000 },
        { value: 1.8, timestamp: 1_033_000 },
        { value: 1.4, timestamp: 1_066_000 },
      ],
    },
    breathing: {
      rate: [{ value: 15.2 }],
      upperTrace: [
        { value: 0.3, timestamp: 1_000_000 },
        { value: 0.7, timestamp: 1_033_000 },
      ],
    },
    face: {
      expression: [
        {
          scores: [
            { type: 8, confidence: 85 }, // surprise
            { type: 5, confidence: 45 }, // happy
            { type: 4, confidence: 15 }, // fear
          ],
        },
      ],
    },
  };

  provider.handleMetrics(mockMetrics, 1_066_000);

  assert.equal(provider.bpm, 78.5);
  assert.equal(provider.breathRate, 15.2);
  assert.equal(provider.confidence, 0.92);
  assert.equal(provider.stable, true);
  assert.ok(provider.pulseTrace.length > 0);
  assert.ok(provider.breathTrace.length > 0);
  assert.deepEqual(provider.expression, {
    surprise: 0.85,
    happy: 0.45,
    fear: 0.15,
  });
});
