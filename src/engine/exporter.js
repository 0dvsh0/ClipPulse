'use strict';

// Pure export formatters. No Electron, no filesystem.
// Every function is deterministic given its inputs so the unit tests can
// assert exact output.

const EXPORT_FORMATS = Object.freeze(['edl', 'txt', 'json']);

function toNumber(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTimecode(seconds, fps = 30) {
  const safeFps = Math.max(1, Math.round(fps));
  const totalFrames = Math.max(0, Math.round(toNumber(seconds) * safeFps));
  const frames = totalFrames % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

function formatChapterTime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(toNumber(seconds)));
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const pad = (n) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(mins)}:${pad(secs)}`;
  return `${pad(mins)}:${pad(secs)}`;
}

function normalizeClips(clips) {
  if (!Array.isArray(clips)) return [];
  return clips
    .filter((clip) => clip && typeof clip === 'object')
    .map((clip, i) => {
      const startSec = Math.max(0, toNumber(clip.startSec, 0));
      const endSec = Math.max(startSec, toNumber(clip.endSec, startSec));
      return {
        ...clip,
        index: Number.isFinite(clip.index) ? clip.index : i + 1,
        startSec,
        endSec,
        peakBpm: toNumber(clip.peakBpm, 0),
        baselineBpm: toNumber(clip.baselineBpm, 0),
        deltaBpm: toNumber(clip.deltaBpm, 0),
        hypeScore: Math.round(toNumber(clip.hypeScore, 0)),
        reason: typeof clip.reason === 'string' ? clip.reason : '',
      };
    })
    .filter((clip) => clip.endSec > clip.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.index - b.index);
}

function clipName(clip) {
  const delta = Number.isFinite(clip.deltaBpm) ? clip.deltaBpm : 0;
  const sign = delta >= 0 ? '+' : '';
  return `ClipPulse Peak ${clip.index} - ${sign}${delta.toFixed(1)} BPM`;
}

function chapterLabel(clip) {
  const delta = Number.isFinite(clip.deltaBpm) ? clip.deltaBpm : 0;
  const sign = delta >= 0 ? '+' : '';
  return `Peak Moment ${clip.index} - ${sign}${delta.toFixed(1)} BPM`;
}

/**
 * CMX 3600 EDL. Source in/out are the clip interval; record in/out lay the
 * clips end-to-end on a fresh timeline. Imports into DaVinci Resolve and
 * Premiere Pro.
 */
function buildEdl(clips, options = {}) {
  const fps = Number.isFinite(options.fps) ? options.fps : 30;
  const title = typeof options.title === 'string' && options.title.trim()
    ? options.title.trim()
    : 'CLIPPULSE HIGHLIGHTS';
  const normalized = normalizeClips(clips);

  const lines = [
    `TITLE: ${title}`,
    'FCM: NON-DROP FRAME',
    '',
  ];

  if (normalized.length === 0) {
    lines.push('* NO PEAK MOMENTS DETECTED');
    lines.push('');
    return lines.join('\n');
  }

  let recordCursor = 0;
  for (const clip of normalized) {
    const duration = clip.endSec - clip.startSec;
    const srcIn = formatTimecode(clip.startSec, fps);
    const srcOut = formatTimecode(clip.endSec, fps);
    const recIn = formatTimecode(recordCursor, fps);
    const recOut = formatTimecode(recordCursor + duration, fps);
    const eventNumber = String(clip.index).padStart(3, '0');

    lines.push(`${eventNumber}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    lines.push(`* FROM CLIP NAME: ${clipName(clip)}`);
    if (clip.reason) lines.push(`* COMMENT: ${clip.reason}`);
    lines.push('');

    recordCursor += duration;
  }

  return lines.join('\n');
}

/**
 * YouTube / Twitch chapter list. The first line is always 00:00 so the
 * platform recognizes the block as chapters.
 */
function buildChapters(clips, options = {}) {
  const normalized = normalizeClips(clips);
  const lines = [];
  const seen = new Set();

  const push = (sec, label) => {
    const stamp = formatChapterTime(sec);
    if (seen.has(stamp)) return;
    seen.add(stamp);
    lines.push(`${stamp} ${label}`);
  };

  if (normalized.length === 0) {
    return '00:00 Session Start\n';
  }

  if (normalized[0].startSec > 0.5) {
    push(0, 'Session Start');
  }

  let lastSec = -Infinity;
  for (const clip of normalized) {
    // Keep chapters at least 10 s apart so YouTube accepts the list.
    if (Number.isFinite(lastSec) && clip.startSec - lastSec < 10) continue;
    push(clip.startSec, chapterLabel(clip));
    lastSec = clip.startSec;
  }

  if (options.includeEnd && Number.isFinite(options.endSec)) {
    const endSec = Math.max(0, options.endSec);
    if (lines.length > 0 && endSec - lastSec >= 10) {
      push(endSec, 'Session End');
    }
  }

  return `${lines.join('\n')}\n`;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildSessionJson(context = {}) {
  const clips = normalizeClips(context.clips);
  const startedAtMs = Number.isFinite(context.startedAtMs) ? context.startedAtMs : 0;
  const endedAtMs = Number.isFinite(context.endedAtMs)
    ? context.endedAtMs
    : (clips.length ? clips.reduce((max, c) => Math.max(max, c.endMs || 0), 0) : startedAtMs);
  const durationSec = Math.max(0, round((endedAtMs - startedAtMs) / 1000, 1));

  const peakBpm = clips.length ? clips.reduce((max, c) => Math.max(max, c.peakBpm || 0), 0) : 0;
  const peakDeltaBpm = clips.length ? clips.reduce((max, c) => Math.max(max, c.deltaBpm || 0), 0) : 0;
  const avgHypeScore = clips.length
    ? round(clips.reduce((sum, c) => sum + c.hypeScore, 0) / clips.length, 1)
    : 0;
  const totalClippedSec = round(
    clips.reduce((sum, c) => sum + (c.endSec - c.startSec), 0),
    1,
  );

  const config = context.config && typeof context.config === 'object' ? context.config : {};
  const payload = {
    schema: 'clippulse.session.v1',
    generatedAtMs: Number.isFinite(context.nowMs) ? context.nowMs : Date.now(),
    mode: context.mode === 'simulator' ? 'simulator' : 'live',
    startedAtMs,
    endedAtMs,
    durationSec,
    config: {
      threshold: toNumber(config.threshold, 70),
      sustainMs: toNumber(config.sustainMs, 2500),
      cooldownMs: toNumber(config.cooldownMs, 30000),
      preRollSec: toNumber(config.preRollSec, 20),
      postRollSec: toNumber(config.postRollSec, 10),
      baselineWindowMs: toNumber(config.baselineWindowMs, 120000),
      expressionBoost: config.expressionBoost === true,
    },
    clips: clips.map((clip) => ({
      id: clip.id || `clip-${String(clip.index).padStart(3, '0')}`,
      index: clip.index,
      triggerAtMs: toNumber(clip.triggerAtMs, 0),
      startMs: toNumber(clip.startMs, 0),
      endMs: toNumber(clip.endMs, 0),
      startSec: round(clip.startSec, 2),
      endSec: round(clip.endSec, 2),
      peakBpm: round(clip.peakBpm, 1),
      baselineBpm: round(clip.baselineBpm, 1),
      deltaBpm: round(clip.deltaBpm, 1),
      breathRate: clip.breathRate == null ? null : round(toNumber(clip.breathRate, 0), 1),
      hypeScore: clip.hypeScore,
      confidence: clip.confidence == null ? null : round(toNumber(clip.confidence, 0), 2),
      reason: clip.reason,
      preRollSec: toNumber(clip.preRollSec, 20),
      postRollSec: toNumber(clip.postRollSec, 10),
    })),
    summary: {
      clipCount: clips.length,
      peakBpm: round(peakBpm, 1),
      peakDeltaBpm: round(peakDeltaBpm, 1),
      avgHypeScore,
      totalClippedSec,
    },
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function buildExport(format, context = {}) {
  switch (format) {
    case 'edl':
      return buildEdl(context.clips, context);
    case 'txt':
      return buildChapters(context.clips, context);
    case 'json':
      return buildSessionJson(context);
    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}

function suggestFilename(format, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
  const ext = format === 'txt' ? 'txt' : format === 'json' ? 'json' : 'edl';
  return `clippulse-${stamp}.${ext}`;
}

module.exports = {
  EXPORT_FORMATS,
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
  round,
  clamp,
};
