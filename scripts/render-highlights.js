'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEMO_DIR = path.join(ROOT, 'demo-assets');
const sampleVideoPath = path.join(DEMO_DIR, 'clippulse-sample-gameplay.mp4');
const highlightsVideoPath = path.join(DEMO_DIR, 'clippulse-highlights.mp4');

function renderHighlights() {
  if (!fs.existsSync(sampleVideoPath)) {
    console.log('[render-highlights] Sample gameplay video missing. Generating demo assets first...');
    const { generateDemoAssets } = require('./generate-demo-assets');
    generateDemoAssets({ renderHighlightsAfter: false });
  }

  console.log(`[render-highlights] Cutting peak segments (10s-25s, 35s-50s) from ${sampleVideoPath} ...`);

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
    // Cut Segment 1: 10s to 25s (15s duration)
    '[0:v]trim=start=10:end=25,setpts=PTS-STARTPTS[v1]',
    '[0:a]atrim=start=10:end=25,asetpts=PTS-STARTPTS[a1]',

    // Cut Segment 2: 35s to 50s (15s duration)
    '[0:v]trim=start=35:end=50,setpts=PTS-STARTPTS[v2]',
    '[0:a]atrim=start=35:end=50,asetpts=PTS-STARTPTS[a2]',

    // Concatenate segments end-to-end
    '[v1][v2]concat=n=2:v=1:a=0[vcat]',
    '[a1][a2]concat=n=2:v=0:a=1[aout]',

    // Overlay conformed record timeline banner and counter
    `[vcat]drawbox=x=0:y=0:w=1920:h=46:color=0x0a101d@0.92:t=fill,` +
    `drawbox=x=0:y=44:w=1920:h=2:color=0x00f0ff@0.8:t=fill,` +
    `drawtext=fontfile='${fontFile}':text='CONFORMED HIGHLIGHT REEL':fontsize=18:fontcolor=0x00f0ff:x=35:y=14,` +
    `drawtext=fontfile='${fontFile}':text='EVENT 1/2 · SURGE (+22.2 BPM)':fontsize=16:fontcolor=0xffaa00:x=400:y=15:enable='between(t,0,15)',` +
    `drawtext=fontfile='${fontFile}':text='EVENT 2/2 · SPIKE (+30.4 BPM)':fontsize=16:fontcolor=0xff4757:x=400:y=15:enable='between(t,15,30)',` +
    `drawtext=fontfile='${fontFile}':text='RECORD TIMECODE\\:':fontsize=16:fontcolor=0x8899aa:x=1440:y=15,` +
    `drawtext=fontfile='${fontFile}':timecode='00\\:00\\:00\\:00':r=30:fontsize=18:fontcolor=0x38ef7d:x=1640:y=14[vout]`,
  ].join(';');

  const ffmpegCmd = [
    'ffmpeg -y',
    `-i "${sampleVideoPath}"`,
    `-filter_complex "${filterGraph}"`,
    '-map "[vout]"',
    '-map "[aout]"',
    '-c:v libx264',
    '-preset veryfast',
    '-crf 20',
    '-pix_fmt yuv420p',
    '-c:a aac',
    '-b:a 128k',
    '-ac 2',
    `"${highlightsVideoPath}"`,
  ].join(' ');

  try {
    execSync(ffmpegCmd, { stdio: 'inherit' });
    console.log(`[render-highlights] Successfully rendered conformed reel: ${highlightsVideoPath}`);
    return highlightsVideoPath;
  } catch (err) {
    console.error('[render-highlights] Error rendering highlights:', err.message);
    throw err;
  }
}

if (require.main === module) {
  renderHighlights();
}

module.exports = { renderHighlights, highlightsVideoPath, sampleVideoPath };
