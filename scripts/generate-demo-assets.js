'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { buildEdl, buildChapters, buildSessionJson } = require('../src/engine/exporter');
const { renderHighlights } = require('./render-highlights');

const ROOT = path.join(__dirname, '..');
const DEMO_DIR = path.join(ROOT, 'demo-assets');

const CLIPS = [
  {
    index: 1,
    id: 'clip-001',
    startSec: 10,
    endSec: 25,
    startMs: 1700000010000,
    endMs: 1700000025000,
    peakBpm: 94.2,
    baselineBpm: 72.0,
    deltaBpm: 22.2,
    hypeScore: 84,
    confidence: 0.88,
    reason: 'Pulse surge +22.2 BPM with expression spike',
  },
  {
    index: 2,
    id: 'clip-002',
    startSec: 35,
    endSec: 50,
    startMs: 1700000035000,
    endMs: 1700000050000,
    peakBpm: 103.5,
    baselineBpm: 73.1,
    deltaBpm: 30.4,
    hypeScore: 92,
    confidence: 0.91,
    reason: 'Intense spike +30.4 BPM with sharp inhale',
  },
];

function generateDemoAssets(options = {}) {
  const renderHighlightsAfter = options.renderHighlightsAfter !== false;

  if (!fs.existsSync(DEMO_DIR)) {
    fs.mkdirSync(DEMO_DIR, { recursive: true });
  }

  console.log('[clippulse] Generating demo assets in demo-assets/ ...');

  // 1. CMX 3600 EDL
  const edlContent = buildEdl(CLIPS, { fps: 30, title: 'CLIPPULSE HIGHLIGHTS' });
  const edlPath = path.join(DEMO_DIR, 'clippulse-highlights.edl');
  fs.writeFileSync(edlPath, edlContent, 'utf8');
  console.log(`[clippulse] Written ${edlPath}`);

  // 2. Chapters TXT
  const chaptersContent = buildChapters(CLIPS, { includeEnd: true, endSec: 60 });
  const chaptersPath = path.join(DEMO_DIR, 'clippulse-chapters.txt');
  fs.writeFileSync(chaptersPath, chaptersContent, 'utf8');
  console.log(`[clippulse] Written ${chaptersPath}`);

  // 3. Session JSON
  const sessionData = buildSessionJson({
    clips: CLIPS,
    nowMs: 1700000060000,
    startedAtMs: 1700000000000,
    endedAtMs: 1700000060000,
    mode: 'live',
    config: {
      threshold: 70,
      sustainMs: 2500,
      cooldownMs: 30000,
      preRollSec: 20,
      postRollSec: 10,
      warmupMs: 20000,
      baselineWindowMs: 120000,
      minConfidence: 0.4,
      minBaselineSamples: 6,
      expressionBoost: true,
    },
  });
  const jsonPath = path.join(DEMO_DIR, 'clippulse-session.json');
  fs.writeFileSync(jsonPath, sessionData, 'utf8');
  console.log(`[clippulse] Written ${jsonPath}`);

  // 4. Ensure source gameplay video exists
  const rawWebmPath = path.join(DEMO_DIR, 'source-gameplay.webm');
  if (!fs.existsSync(rawWebmPath)) {
    const rootWebm = path.join(ROOT, 'temp_gameplay.webm');
    if (fs.existsSync(rootWebm)) {
      fs.copyFileSync(rootWebm, rawWebmPath);
    } else {
      console.log('[clippulse] Downloading real gameplay clip from Wikimedia Commons into temp file...');
      const url = 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Dishonored_2_gameplay_clip.webm';
      const tempPath = path.join(DEMO_DIR, 'temp-gameplay.webm');
      const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
      const curlCmd = `${curlBin} -s -L -H "Referer: https://commons.wikimedia.org/" -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 ClipPulse/1.0" -o "${tempPath}" "${url}"`;
      execSync(curlCmd, { stdio: 'inherit' });
      if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 100000) {
        fs.renameSync(tempPath, rawWebmPath);
      }
    }
  }

  // 5. Generate clippulse-sample-gameplay.mp4 via FFmpeg
  const videoPath = path.join(DEMO_DIR, 'clippulse-sample-gameplay.mp4');
  console.log(`[clippulse] Rendering 60s 1080p 30fps sample video: ${videoPath} ...`);

  let fontFile = 'C\\:/Windows/Fonts/consola.ttf';
  if (process.platform === 'win32') {
    if (!fs.existsSync('C:/Windows/Fonts/consola.ttf')) {
      fontFile = 'C\\:/Windows/Fonts/arial.ttf';
    }
  } else if (process.platform === 'darwin') {
    fontFile = '/System/Library/Fonts/Menlo.ttc';
  } else {
    fontFile = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';
  }

  const filterGraph = [
    // Top header bar
    `drawbox=x=0:y=0:w=1920:h=60:color=0x0b0f17@0.85:t=fill`,
    `drawtext=fontfile='${fontFile}':text='CLIPPULSE GAMEPLAY CAPTURE':fontsize=24:fontcolor=0x00f0ff:x=35:y=18`,
    `drawtext=fontfile='${fontFile}':text='1080P 30FPS · 60s SOURCE RUN':fontsize=18:fontcolor=0x8899aa:x=460:y=22`,
    `drawtext=fontfile='${fontFile}':text='BIOMETRIC AUTO-CLIPPER ARMED':fontsize=18:fontcolor=0x38ef7d:x=1520:y=22`,

    // Biometric Telemetry HUD Top-Right
    `drawbox=x=1380:y=75:w=505:h=160:color=0x0e131d@0.9:t=fill`,
    `drawbox=x=1380:y=75:w=505:h=160:color=0x00f0ff@0.5:t=1`,
    `drawtext=fontfile='${fontFile}':text='BIOMETRIC TELEMETRY HUD':fontsize=16:fontcolor=0x00f0ff:x=1400:y=92`,

    // Normal state HUD (t < 10, 25 <= t < 35, t >= 50)
    `drawtext=fontfile='${fontFile}':text='PULSE\\: 72.0 BPM (BASELINE)':fontsize=22:fontcolor=0x38ef7d:x=1400:y=125:enable='not(between(t,10,25)+between(t,35,50))'`,
    `drawtext=fontfile='${fontFile}':text='BREATH\\: 14.5 BR/MIN  CONF\\: 94 PCT':fontsize=17:fontcolor=0x8899aa:x=1400:y=160:enable='not(between(t,10,25)+between(t,35,50))'`,
    `drawtext=fontfile='${fontFile}':text='STATUS\\: NORMAL MONITORING':fontsize=16:fontcolor=0x38ef7d:x=1400:y=195:enable='not(between(t,10,25)+between(t,35,50))'`,

    // Peak 1 state HUD (10 <= t < 25)
    `drawtext=fontfile='${fontFile}':text='PULSE\\: 94.2 BPM (+22.2 SURGE)':fontsize=22:fontcolor=0xffaa00:x=1400:y=125:enable='between(t,10,25)'`,
    `drawtext=fontfile='${fontFile}':text='BREATH\\: 21.0 BR/MIN  CONF\\: 88 PCT':fontsize=17:fontcolor=0xffaa00:x=1400:y=160:enable='between(t,10,25)'`,
    `drawtext=fontfile='${fontFile}':text='STATUS\\: PEAK 1 CAPTURED':fontsize=16:fontcolor=0xffaa00:x=1400:y=195:enable='between(t,10,25)'`,

    // Peak 2 state HUD (35 <= t < 50)
    `drawtext=fontfile='${fontFile}':text='PULSE\\: 103.5 BPM (+30.4 SPIKE)':fontsize=22:fontcolor=0xff4757:x=1400:y=125:enable='between(t,35,50)'`,
    `drawtext=fontfile='${fontFile}':text='BREATH\\: 26.2 BR/MIN  CONF\\: 91 PCT':fontsize=17:fontcolor=0xff4757:x=1400:y=160:enable='between(t,35,50)'`,
    `drawtext=fontfile='${fontFile}':text='STATUS\\: PEAK 2 CAPTURED':fontsize=16:fontcolor=0xff4757:x=1400:y=195:enable='between(t,35,50)'`,

    // Peak 1 Center-Top Banner
    `drawbox=x=(w-960)/2:y=75:w=960:h=50:color=0x2b1e05@0.9:t=fill:enable='between(t,10,25)'`,
    `drawbox=x=(w-960)/2:y=75:w=960:h=50:color=0xffaa00@1:t=1:enable='between(t,10,25)'`,
    `drawtext=fontfile='${fontFile}':text='▶ PEAK 1 DETECTED (+22.2 BPM) | EDL CUT\\: 00\\:00\\:10\\:00 -> 00\\:00\\:25\\:00':fontsize=18:fontcolor=0xffaa00:x=(w-text_w)/2:y=90:enable='between(t,10,25)'`,

    // Peak 2 Center-Top Banner
    `drawbox=x=(w-960)/2:y=75:w=960:h=50:color=0x38090d@0.9:t=fill:enable='between(t,35,50)'`,
    `drawbox=x=(w-960)/2:y=75:w=960:h=50:color=0xff4757@1:t=1:enable='between(t,35,50)'`,
    `drawtext=fontfile='${fontFile}':text='▶ PEAK 2 DETECTED (+30.4 BPM) | EDL CUT\\: 00\\:00\\:35\\:00 -> 00\\:00\\:50\\:00':fontsize=18:fontcolor=0xff4757:x=(w-text_w)/2:y=90:enable='between(t,35,50)'`,

    // Bottom Burned-in Timecode Box
    `drawbox=x=(w-680)/2:y=h-110:w=680:h=90:color=0x0b0f17@0.92:t=fill`,
    `drawbox=x=(w-680)/2:y=h-110:w=680:h=90:color=0x00f0ff@0.6:t=1`,
    `drawtext=fontfile='${fontFile}':text='SOURCE TIMECODE (CMX 3600 CONFORM TARGET)':fontsize=14:fontcolor=0x00f0ff:x=(w-text_w)/2:y=h-100`,
    `drawtext=fontfile='${fontFile}':timecode='00\\:00\\:00\\:00':r=30:fontsize=48:fontcolor=0xffffff:x=(w-text_w)/2:y=h-78`,

    // Lower Left & Right Badges
    `drawtext=fontfile='${fontFile}':text='FPS\\: 30.00 NON-DROP':fontsize=16:fontcolor=0x8899aa:x=40:y=h-45`,
    `drawtext=fontfile='${fontFile}':text='MATCHING EDL\\: clippulse-highlights.edl':fontsize=16:fontcolor=0x8899aa:x=1470:y=h-45`,
  ].join(',');

  const ffmpegCmd = [
    'ffmpeg -y',
    `-stream_loop -1 -i "${rawWebmPath}"`,
    '-f lavfi -i "sine=frequency=110:duration=60:sample_rate=48000"',
    '-t 60',
    `-filter_complex "[0:v]fps=30,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1/1,${filterGraph}[vout]"`,
    '-map "[vout]"',
    '-map 1:a',
    '-c:v libx264',
    '-preset veryfast',
    '-crf 20',
    '-pix_fmt yuv420p',
    '-c:a aac',
    '-b:a 128k',
    '-ac 2',
    `"${videoPath}"`,
  ].join(' ');

  execSync(ffmpegCmd, { stdio: 'inherit' });
  console.log(`[clippulse] Successfully rendered ${videoPath}`);

  // 6. Invoke render-highlights.js to build the conformed 30-second highlight reel
  if (renderHighlightsAfter) {
    console.log('[clippulse] Rendering conformed highlight reel...');
    renderHighlights();
  }

  // 7. Write demo README.md
  const readmeContent = `# ClipPulse Demonstration Assets & Conformed Highlight Reel

This directory contains real 1080p gameplay footage, a conformed 30-second highlight video reel, and standard CMX 3600 EDL exports to verify ClipPulse's deterministic clipping engine.

## Included Assets

- \`clippulse-sample-gameplay.mp4\`: 60-second 1080p 30fps action combat gameplay capture with burned-in frame-accurate source timecode (\`00:00:00:00\` to \`00:00:59:29\`) and telemetry HUD.
- \`clippulse-highlights.mp4\`: 30-second conformed highlight video reel physically cut and assembled at the exact peak moments by ClipPulse.
- \`clippulse-highlights.edl\`: Standard CMX 3600 Edit Decision List containing the two detected peak moments.
- \`clippulse-chapters.txt\`: Platform-ready chapter timestamps formatted for YouTube and Twitch VODs.
- \`clippulse-session.json\`: Telemetry schema export capturing complete session metrics, baseline statistics, and clip records.

## Peak Moments Reference

- **Peak 1 (Surge):** \`00:00:10:00\` – \`00:00:25:00\` (+22.2 BPM surge, score 84)
- **Peak 2 (Spike):** \`00:00:35:00\` – \`00:00:50:00\` (+30.4 BPM spike, score 92)
- **Conformed Assembly Duration:** Exactly 00:00:30:00 (15 seconds + 15 seconds)

---

## Direct Playback (No NLE Required)

You can play \`clippulse-highlights.mp4\` immediately in VLC Media Player, Windows Media Player, or right inside the **ClipPulse Stage** by clicking **Play Cut Highlights (.mp4)** in the Highlight Reel modal.

Notice how:
1. Event 1 plays from \`00:00:00:00\` to \`00:00:15:00\` (source timecode \`00:00:10:00\` to \`00:00:25:00\`).
2. At exactly \`00:00:15:00\`, a frame-accurate cut occurs, transitioning immediately to Peak 2 (source timecode \`00:00:35:00\`).
3. Event 2 plays from \`00:00:15:00\` to \`00:00:30:00\` (source timecode \`00:00:35:00\` to \`00:00:50:00\`).

---

## 3-Click DaVinci Resolve Import

1. **Import Media:** Drag \`clippulse-sample-gameplay.mp4\` into the DaVinci Resolve Media Pool.
2. **Import Timeline:** Go to **File → Import → Timeline...** (or press \`Ctrl+Shift+I\`) and select \`clippulse-highlights.edl\`.
3. **Conform:** In the import dialog, set timeline frame rate to **30 fps**. Click **OK**. DaVinci automatically cuts the clips on tracks V1/A1 at the exact peak moments.

---

## 3-Click Adobe Premiere Pro Import

1. **Import Media:** Drag \`clippulse-sample-gameplay.mp4\` into the Premiere Pro Project panel.
2. **Import EDL:** Go to **File → Import...** (or press \`Ctrl+I\`) and select \`clippulse-highlights.edl\`.
3. **Link Media:** Right-click the newly created sequence in the Project panel, choose **Link Media...**, and point to \`clippulse-sample-gameplay.mp4\`.
`;
  const readmePath = path.join(DEMO_DIR, 'README.md');
  fs.writeFileSync(readmePath, readmeContent, 'utf8');
  console.log(`[clippulse] Written ${readmePath}`);
}

if (require.main === module) {
  generateDemoAssets();
}

module.exports = { generateDemoAssets, CLIPS };
