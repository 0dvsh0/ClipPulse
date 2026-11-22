'use strict';

// Preload bridge.
//
// The SmartSpectra renderer SDK needs its own preload bridge. This file loads
// that bridge first, then exposes the small ClipPulse API on top of it.
// `sandbox: false` is set on the BrowserWindow because a sandboxed preload
// cannot require the SDK's preload module; contextIsolation stays on and Node
// integration stays off.

const { contextBridge, ipcRenderer } = require('electron');

require('@smartspectra/node-sdk/preload');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('clippulse', {
  // preflight / consent / keys
  preflight: () => ipcRenderer.invoke('app:preflight'),
  setConsent: (value) => ipcRenderer.invoke('consent:set', value === true),
  setApiKey: (key) => ipcRenderer.invoke('key:set', String(key == null ? '' : key)),

  // session lifecycle
  startSession: (options) => ipcRenderer.invoke('session:start', options || {}),
  stopSession: () => ipcRenderer.invoke('session:stop'),
  killCamera: () => ipcRenderer.invoke('camera:kill'),
  ackKill: () => ipcRenderer.send('camera:killed'),
  skipWarmup: () => ipcRenderer.invoke('session:skip-warmup'),

  // telemetry
  sendFrame: (frame) => ipcRenderer.send('telemetry:frame', frame),
  sendEvent: (event) => ipcRenderer.send('telemetry:event', event),

  // settings / exports / OBS
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings || {}),
  exportPreview: (format) => ipcRenderer.invoke('export:preview', format),
  exportSave: (format) => ipcRenderer.invoke('export:save', format),
  obsConnect: (options) => ipcRenderer.invoke('obs:connect', options || {}),
  obsDisconnect: () => ipcRenderer.invoke('obs:disconnect'),

  // local links / clipboard
  overlayUrl: () => ipcRenderer.invoke('overlay:url'),
  openOverlay: () => ipcRenderer.invoke('overlay:open'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openDemoFolder: () => ipcRenderer.invoke('demo:open-folder'),
  getSampleVideoBuffer: () => ipcRenderer.invoke('demo:sample-video-buffer'),
  getHighlightsVideoBuffer: () => ipcRenderer.invoke('demo:highlights-video-buffer'),

  // main → renderer events
  onState: (callback) => subscribe('clippulse:state', callback),
  onClip: (callback) => subscribe('clippulse:clip', callback),
  onEvent: (callback) => subscribe('clippulse:event', callback),
  onKill: (callback) => subscribe('clippulse:kill', callback),
  onToast: (callback) => subscribe('clippulse:toast', callback),
});
