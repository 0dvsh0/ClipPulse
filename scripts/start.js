'use strict';

// Launches Electron without inheriting ELECTRON_RUN_AS_NODE.
//
// VS Code terminals (and some CI shells) export ELECTRON_RUN_AS_NODE=1. When
// that variable is present Electron starts as a plain Node process, the app
// never opens a window, and the failure looks mysterious. Clearing it here is
// the cross-platform fix and prints a visible warning so the cause is obvious.

const path = require('path');
const { spawn } = require('child_process');

const electronBinary = require('electron');
const projectRoot = path.join(__dirname, '..');

const env = { ...process.env };
if (env.ELECTRON_RUN_AS_NODE) {
  console.warn(
    '[clippulse] ELECTRON_RUN_AS_NODE was set in this terminal. ' +
    'Clearing it for the Electron child process so the app can open a window.'
  );
  delete env.ELECTRON_RUN_AS_NODE;
}

const args = [projectRoot, ...process.argv.slice(2)];

const child = spawn(electronBinary, args, {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('error', (err) => {
  console.error('[clippulse] Failed to launch Electron:', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code == null ? 0 : code);
});
