'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatTimecode,
  formatChapterTime,
  buildEdl,
  buildChapters,
  buildSessionJson,
  buildExport,
  suggestFilename,
  normalizeClips,
  clipName,
  chapterLabel,
} = require('../src/engine/exporter');

// The brief bans six terms in exports. Assemble them from fragments so this
// test file itself never contains the literal words.
const BANNED = [
  ['str', 'ess'],
  ['anxiet', 'y'],
  ['diagnos', 'is'],
  ['heal', 'th'],
  ['fatigu', 'ed'],
  ['abnorm', 'al'],
].map((parts) => parts.join(''));

function assertClean(text, label) {
  const lower = String(text).toLowerCase();
  for (const term of BANNED) {
    assert.equal(lower.includes(term), false, `${label} must not contain a banned term`);
  }
}

const CLIPS = [
  {
    id: 'clip-001',
    index: 1,
    triggerAtMs: 1_030_000,
    startMs: 1_010_000,
    endMs: 1_040_000,
    startSec: 10,
    endSec: 30,
    peakBpm: 92,
    baselineBpm: 70,
    deltaBpm: 22,
    hypeScore: 88,
    confidence: 0.86,
    reason: '+22.0 BPM spike',
  },
  {
    id: 'clip-002',
    index: 2,
    triggerAtMs: 1_065_500,
    startMs: 1_045_500,
    endMs: 1_075_500,
    startSec: 45.5,
    endSec: 65.5,
    peakBpm: 88,
    baselineBpm: 70,
    deltaBpm: 18,
    hypeScore: 81,
    confidence: 0.79,
    reason: 'rapid breath',
  },
];

test('formatTimecode renders frame-accurate CMX timecodes', () => {
  assert.equal(formatTimecode(0), '00:00:00:00');
  assert.equal(formatTimecode(1.5, 30), '00:00:01:15');
  assert.equal(formatTimecode(61, 30), '00:01:01:00');
  assert.equal(formatTimecode(3661, 30), '01:01:01:00');
  assert.equal(formatTimecode(10, 25), '00:00:10:00');
  assert.equal(formatTimecode(-5), '00:00:00:00');
  assert.equal(formatTimecode(59.99, 30), '00:01:00:00');
});

test('formatChapterTime renders platform-friendly chapter stamps', () => {
  assert.equal(formatChapterTime(0), '00:00');
  assert.equal(formatChapterTime(59.9), '00:59');
  assert.equal(formatChapterTime(60), '01:00');
  assert.equal(formatChapterTime(120), '02:00');
  assert.equal(formatChapterTime(3661), '1:01:01');
  assert.equal(formatChapterTime(-2), '00:00');
});

test('normalizeClips sorts, clamps, and drops empty ranges', () => {
  const normalized = normalizeClips([
    { index: 2, startSec: 30, endSec: 40 },
    { index: 1, startSec: 5, endSec: 5 },
    null,
    { index: 3, startSec: 1, endSec: 12, peakBpm: '80' },
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].index, 3);
  assert.equal(normalized[0].peakBpm, 80);
  assert.equal(normalized[1].index, 2);
  assert.equal(normalizeClips('nope').length, 0);
});

test('buildEdl lays clips end-to-end on a fresh record timeline', () => {
  const edl = buildEdl(CLIPS);

  const expected = [
    'TITLE: CLIPPULSE HIGHLIGHTS',
    'FCM: NON-DROP FRAME',
    '',
    '001  AX       V     C        00:00:10:00 00:00:30:00 00:00:00:00 00:00:20:00',
    '* FROM CLIP NAME: ClipPulse Peak 1 - +22.0 BPM',
    '* COMMENT: +22.0 BPM spike',
    '',
    '002  AX       V     C        00:00:45:15 00:01:05:15 00:00:20:00 00:00:40:00',
    '* FROM CLIP NAME: ClipPulse Peak 2 - +18.0 BPM',
    '* COMMENT: rapid breath',
    '',
  ].join('\n');

  assert.equal(edl, expected);
  assertClean(edl, 'EDL');
});

test('buildEdl honours fps and custom title', () => {
  const edl = buildEdl([{ index: 1, startSec: 1, endSec: 2, deltaBpm: 4 }], {
    fps: 25,
    title: '  MY SESSION  ',
  });

  assert.match(edl, /^TITLE: MY SESSION$/m);
  assert.match(edl, /00:00:01:00 00:00:02:00 00:00:00:00 00:00:01:00/);
});

test('buildEdl marks an empty session without emitting events', () => {
  const edl = buildEdl([]);
  assert.match(edl, /TITLE: CLIPPULSE HIGHLIGHTS/);
  assert.match(edl, /\* NO PEAK MOMENTS DETECTED/);
  assert.equal(/\bAX\b/.test(edl), false);
  assertClean(edl, 'empty EDL');
});

test('buildChapters always opens at 00:00 and spaces chapters', () => {
  const chapters = buildChapters([
    { index: 1, startSec: 30, endSec: 50, deltaBpm: 22 },
    { index: 2, startSec: 60, endSec: 80, deltaBpm: 18 },
    { index: 3, startSec: 65, endSec: 85, deltaBpm: 15 },
    { index: 4, startSec: 120, endSec: 140, deltaBpm: 12.5 },
  ]);

  const expected = [
    '00:00 Session Start',
    '00:30 Peak Moment 1 - +22.0 BPM',
    '01:00 Peak Moment 2 - +18.0 BPM',
    '02:00 Peak Moment 4 - +12.5 BPM',
    '',
  ].join('\n');

  assert.equal(chapters, expected);
  assertClean(chapters, 'chapters');
});

test('buildChapters starts at the first clip when it lands on zero', () => {
  const chapters = buildChapters([{ index: 1, startSec: 0, endSec: 20, deltaBpm: 9 }]);
  assert.equal(chapters, '00:00 Peak Moment 1 - +9.0 BPM\n');
});

test('buildChapters handles empty sessions and optional end markers', () => {
  assert.equal(buildChapters([]), '00:00 Session Start\n');

  const chapters = buildChapters(
    [{ index: 1, startSec: 30, endSec: 50, deltaBpm: 20 }],
    { includeEnd: true, endSec: 200 },
  );
  assert.equal(chapters, [
    '00:00 Session Start',
    '00:30 Peak Moment 1 - +20.0 BPM',
    '03:20 Session End',
    '',
  ].join('\n'));
});

test('buildSessionJson emits a stable schema and summary', () => {
  const text = buildSessionJson({
    clips: CLIPS,
    startedAtMs: 1_000_000,
    endedAtMs: 1_120_000,
    mode: 'simulator',
    nowMs: 2_000_000,
    config: {
      threshold: 72,
      sustainMs: 2500,
      cooldownMs: 30000,
      preRollSec: 20,
      postRollSec: 10,
      baselineWindowMs: 120000,
      expressionBoost: true,
    },
  });

  const payload = JSON.parse(text);
  assert.equal(payload.schema, 'clippulse.session.v1');
  assert.equal(payload.generatedAtMs, 2_000_000);
  assert.equal(payload.mode, 'simulator');
  assert.equal(payload.durationSec, 120);
  assert.equal(payload.config.threshold, 72);
  assert.equal(payload.config.expressionBoost, true);
  assert.equal(payload.clips.length, 2);
  assert.equal(payload.clips[0].id, 'clip-001');
  assert.equal(payload.clips[0].peakBpm, 92);
  assert.equal(payload.summary.clipCount, 2);
  assert.equal(payload.summary.peakBpm, 92);
  assert.equal(payload.summary.peakDeltaBpm, 22);
  assert.equal(payload.summary.avgHypeScore, 84.5);
  assert.equal(payload.summary.totalClippedSec, 40);
  assertClean(text, 'session JSON');
});

test('buildSessionJson tolerates a missing session context', () => {
  const payload = JSON.parse(buildSessionJson({ clips: [] }));
  assert.equal(payload.summary.clipCount, 0);
  assert.equal(payload.durationSec, 0);
  assert.equal(payload.clips.length, 0);
});

test('buildSessionJson retains explicit session mode and defaults to live', () => {
  const simJson = JSON.parse(buildSessionJson({ mode: 'simulator' }));
  assert.equal(simJson.mode, 'simulator');

  const liveJson = JSON.parse(buildSessionJson({ mode: 'live' }));
  assert.equal(liveJson.mode, 'live');

  const defaultJson = JSON.parse(buildSessionJson({}));
  assert.equal(defaultJson.mode, 'live');
});

test('buildExport routes every supported format and rejects the rest', () => {
  assert.match(buildExport('edl', { clips: CLIPS }), /^TITLE:/);
  assert.match(buildExport('txt', { clips: CLIPS }), /^00:00 Session Start/m);
  assert.match(buildExport('json', { clips: CLIPS }), /"schema": "clippulse\.session\.v1"/);
  assert.throws(() => buildExport('srt', { clips: CLIPS }), /Unknown export format/);
});

test('suggestFilename is deterministic and format-aware', () => {
  const stamp = new Date(2026, 0, 5, 7, 8, 9);
  assert.equal(suggestFilename('edl', stamp), 'clippulse-20260105-070809.edl');
  assert.equal(suggestFilename('txt', stamp), 'clippulse-20260105-070809.txt');
  assert.equal(suggestFilename('json', stamp), 'clippulse-20260105-070809.json');
});

test('clipName and chapterLabel format positive, negative, and zero deltas accurately', () => {
  assert.equal(clipName({ index: 1, deltaBpm: 14.2 }), 'ClipPulse Peak 1 - +14.2 BPM');
  assert.equal(clipName({ index: 2, deltaBpm: -4.5 }), 'ClipPulse Peak 2 - -4.5 BPM');
  assert.equal(clipName({ index: 3, deltaBpm: 0 }), 'ClipPulse Peak 3 - +0.0 BPM');
  assert.equal(chapterLabel({ index: 1, deltaBpm: 14.2 }), 'Peak Moment 1 - +14.2 BPM');
  assert.equal(chapterLabel({ index: 2, deltaBpm: -4.5 }), 'Peak Moment 2 - -4.5 BPM');
  assert.equal(chapterLabel({ index: 3, deltaBpm: 0 }), 'Peak Moment 3 - +0.0 BPM');
});
