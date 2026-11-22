'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const OVERLAY_DIR = path.join(__dirname, '..', 'overlay');

const STATIC_ROUTES = Object.freeze({
  '/overlay': 'overlay.html',
  '/overlay/': 'overlay.html',
  '/overlay.html': 'overlay.html',
  '/overlay/overlay.html': 'overlay.html',
  '/overlay.css': 'overlay.css',
  '/overlay.js': 'overlay.js',
  '/overlay/overlay.css': 'overlay.css',
  '/overlay/overlay.js': 'overlay.js',
});

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
});

const BASE_CSP = Object.freeze([
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  // The studio preview embeds this page from a file:// shell. `*` covers
  // network origins, but file: must be named explicitly for that preview.
  "frame-ancestors * file:",
]);

const CSP = [...BASE_CSP, "connect-src ws://127.0.0.1:4789"].join('; ');

/**
 * Loopback-only static server + WebSocket broadcast hub for the OBS overlay.
 *
 * The socket carries small JSON state packets. It never carries frames,
 * images, API keys, or file paths.
 */
class OverlayServer {
  constructor({
    port = 4789,
    host = '127.0.0.1',
    getSnapshot = () => ({}),
    onClientCount = null,
  } = {}) {
    this.port = port;
    this.host = host;
    this.getSnapshot = getSnapshot;
    this.onClientCount = typeof onClientCount === 'function' ? onClientCount : () => {};
    this.server = null;
    this.wss = null;
    this.clients = new Set();
    this.heartbeat = null;
    this.status = 'idle';
    this.startedAt = null;
  }

  get url() {
    return `http://${this.host}:${this.port}/overlay`;
  }

  async start() {
    if (this.server) return this.url;

    const server = http.createServer((req, res) => this.handleHttp(req, res));
    const wss = new WebSocketServer({
      server,
      path: '/ws',
      perMessageDeflate: false,
      maxPayload: 64 * 1024,
    });

    wss.on('connection', (ws) => this.handleConnection(ws));

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.port, this.host);
    });

    this.server = server;
    this.wss = wss;
    this.status = 'listening';
    this.startedAt = Date.now();

    this.heartbeat = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) {
          try { ws.terminate(); } catch { /* ignore */ }
          continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* ignore */ }
      }
    }, 30000);
    if (typeof this.heartbeat.unref === 'function') this.heartbeat.unref();

    return this.url;
  }

  getCsp() {
    return [...BASE_CSP, `connect-src ws://${this.host}:${this.port}`].join('; ');
  }

  handleHttp(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      this.writeText(res, 405, 'Method not allowed');
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url, `http://${this.host}:${this.port}`).pathname;
    } catch {
      this.writeText(res, 400, 'Bad request');
      return;
    }

    if (pathname === '/') {
      res.writeHead(302, { Location: '/overlay', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (pathname === '/status') {
      const body = JSON.stringify({
        ok: true,
        status: this.status,
        clients: this.clients.size,
        uptimeSec: this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
        mode: 'telemetry-only',
      });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(body);
      return;
    }

    if (pathname === '/favicon.ico') {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    const fileName = STATIC_ROUTES[pathname];
    if (!fileName) {
      this.writeText(res, 404, 'Not found');
      return;
    }

    const filePath = path.join(OVERLAY_DIR, fileName);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        this.writeText(res, 500, 'Overlay asset unavailable');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': this.getCsp(),
      });
      if (req.method === 'HEAD') res.end();
      else res.end(data);
    });
  }

  writeText(res, status, text) {
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(text);
  }

  handleConnection(ws) {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => { /* client vanished */ });
    ws.on('close', () => {
      this.clients.delete(ws);
      this.onClientCount(this.clients.size);
    });

    this.clients.add(ws);
    this.onClientCount(this.clients.size);

    let snapshot = {};
    try {
      if (typeof this.getSnapshot === 'function') {
        snapshot = this.getSnapshot() || {};
      }
    } catch {
      snapshot = {};
    }
    this.send(ws, { type: 'state', ...snapshot });
  }

  send(ws, payload) {
    if (!ws || ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* slow or closing client */
    }
  }

  broadcast(payload) {
    if (!this.wss) return 0;
    const text = JSON.stringify(payload);
    let sent = 0;
    for (const ws of [...this.clients]) {
      if (ws.readyState !== ws.OPEN) continue;
      try {
        ws.send(text);
        sent += 1;
      } catch {
        /* skip */
      }
    }
    return sent;
  }

  broadcastState(state) {
    return this.broadcast({ type: 'state', ...state });
  }

  broadcastClip(clip) {
    return this.broadcast({ type: 'clip', clip });
  }

  async stop() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const ws of [...this.clients]) {
      try { ws.close(1001, 'server stopping'); } catch { /* ignore */ }
    }
    this.clients.clear();
    if (this.wss) {
      try { this.wss.close(); } catch { /* ignore */ }
      this.wss = null;
    }
    const server = this.server;
    this.server = null;
    this.status = 'stopped';
    if (!server) return;
    if (typeof server.closeAllConnections === 'function') {
      try { server.closeAllConnections(); } catch { /* ignore */ }
    }
    await new Promise((resolve) => {
      try {
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}

module.exports = { OverlayServer, CSP, OVERLAY_DIR };
