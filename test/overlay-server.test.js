'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket } = require('ws');

const { OverlayServer } = require('../src/server/overlay-server');

const TEST_PORT = 4889;
const TEST_HOST = '127.0.0.1';

function fetchUrl(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: TEST_HOST,
        port: TEST_PORT,
        path: pathname,
        method,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('overlay server serves static assets and responds to status query', async () => {
  const snapshot = {
    bpm: 72,
    mode: 'SIMULATOR',
    status: 'live',
  };

  const server = new OverlayServer({
    port: TEST_PORT,
    host: TEST_HOST,
    getSnapshot: () => snapshot,
  });

  const url = await server.start();
  assert.equal(url, `http://${TEST_HOST}:${TEST_PORT}/overlay`);

  // Root redirect
  const rootRes = await fetchUrl('/');
  assert.equal(rootRes.status, 302);
  assert.equal(rootRes.headers.location, '/overlay');

  // Status endpoint
  const statusRes = await fetchUrl('/status');
  assert.equal(statusRes.status, 200);
  const statusJson = JSON.parse(statusRes.body);
  assert.equal(statusJson.ok, true);
  assert.equal(statusJson.status, 'listening');

  // Overlay HTML page
  const htmlRes = await fetchUrl('/overlay');
  assert.equal(htmlRes.status, 200);
  assert.match(htmlRes.headers['content-type'], /text\/html/);
  assert.match(htmlRes.headers['content-security-policy'], /connect-src ws:\/\/127\.0\.0\.1:4889/);
  assert.match(htmlRes.headers['content-security-policy'], /frame-ancestors \* file:/);
  assert.ok(htmlRes.body.includes('ClipPulse Overlay'));

  // Overlay HTML aliases
  const htmlAliasRes = await fetchUrl('/overlay.html');
  assert.equal(htmlAliasRes.status, 200);
  assert.match(htmlAliasRes.headers['content-type'], /text\/html/);

  const htmlSubAliasRes = await fetchUrl('/overlay/overlay.html');
  assert.equal(htmlSubAliasRes.status, 200);
  assert.match(htmlSubAliasRes.headers['content-type'], /text\/html/);

  // Overlay CSS and alias
  const cssRes = await fetchUrl('/overlay.css');
  assert.equal(cssRes.status, 200);
  assert.match(cssRes.headers['content-type'], /text\/css/);

  const cssAliasRes = await fetchUrl('/overlay/overlay.css');
  assert.equal(cssAliasRes.status, 200);
  assert.match(cssAliasRes.headers['content-type'], /text\/css/);

  // Overlay JS and alias
  const jsRes = await fetchUrl('/overlay.js');
  assert.equal(jsRes.status, 200);
  assert.match(jsRes.headers['content-type'], /text\/javascript/);

  const jsAliasRes = await fetchUrl('/overlay/overlay.js');
  assert.equal(jsAliasRes.status, 200);
  assert.match(jsAliasRes.headers['content-type'], /text\/javascript/);

  // Favicon 204
  const favRes = await fetchUrl('/favicon.ico');
  assert.equal(favRes.status, 204);

  // HEAD status query
  const headRes = await fetchUrl('/status', 'HEAD');
  assert.equal(headRes.status, 200);
  assert.equal(headRes.body, '');

  // 404 for unknown route
  const notFoundRes = await fetchUrl('/unknown-file.txt');
  assert.equal(notFoundRes.status, 404);

  // 405 for POST request
  const methodRes = await fetchUrl('/overlay', 'POST');
  assert.equal(methodRes.status, 405);

  // Test WebSocket connection and broadcast
  const client = new WebSocket(`ws://${TEST_HOST}:${TEST_PORT}/ws`);
  const received = [];

  await new Promise((resolve, reject) => {
    client.on('open', resolve);
    client.on('error', reject);
    client.on('message', (data) => {
      received.push(JSON.parse(data.toString()));
    });
  });

  // Client should receive initial snapshot on connection
  assert.ok(received.length >= 1, 'client should receive initial snapshot packet');
  assert.equal(received[0].type, 'state');
  assert.equal(received[0].bpm, 72);

  // Broadcast state
  server.broadcastState({ bpm: 88, hypeScore: 75 });

  // Broadcast clip
  server.broadcastClip({ id: 'clip-001', deltaBpm: 15 });

  // Give short grace period for socket message receipt
  await new Promise((resolve) => setTimeout(resolve, 80));

  const stateMsg = received.find((m) => m.type === 'state' && m.bpm === 88);
  assert.ok(stateMsg, 'client should receive broadcasted state');
  assert.equal(stateMsg.hypeScore, 75);

  const clipMsg = received.find((m) => m.type === 'clip');
  assert.ok(clipMsg, 'client should receive broadcasted clip');
  assert.equal(clipMsg.clip.id, 'clip-001');

  // Close client and stop server
  client.close();
  await server.stop();
  assert.equal(server.status, 'stopped');
});
