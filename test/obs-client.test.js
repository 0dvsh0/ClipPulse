'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ObsClient } = require('../src/engine/obs-client');

test('obs client initializes with offline state and sensible defaults', () => {
  const client = new ObsClient();
  assert.equal(client.status, 'offline');
  assert.equal(client.connected, false);
  assert.equal(client.url, 'ws://127.0.0.1:4455');
  assert.equal(client.password, '');
  assert.equal(client.lastError, null);
  assert.equal(client.replayActive, null);
  assert.equal(client.recordActive, null);
});

test('obs client accepts custom url and password', () => {
  const client = new ObsClient({
    url: 'ws://192.168.1.100:4455',
    password: 'secret-password',
  });
  assert.equal(client.url, 'ws://192.168.1.100:4455');
  assert.equal(client.password, 'secret-password');
});

test('onClip returns offline result safely when client is not connected', async () => {
  const statuses = [];
  const client = new ObsClient({
    onStatus: (s) => statuses.push(s.status),
  });

  const clip = {
    id: 'clip-001',
    deltaBpm: 14.2,
    peakBpm: 94.0,
    reason: '+14.2 BPM spike',
  };

  const result = await client.onClip(clip);
  assert.deepEqual(result, {
    attempted: false,
    replay: 'OBS offline',
    chapter: 'OBS offline',
  });
  assert.equal(client.lastAction, result);
});

test('disconnect cleanly resets state and triggers status listener', () => {
  let reported = null;
  const client = new ObsClient({
    onStatus: (s) => { reported = s; },
  });

  client.disconnect();
  assert.equal(client.connected, false);
  assert.equal(client.status, 'offline');
  assert.ok(reported, 'status listener should receive update');
  assert.equal(reported.connected, false);
});

test('onClip executes SaveReplayBuffer and CreateRecordChapter when connected', async () => {
  const calls = [];
  const client = new ObsClient();
  client.connected = true;
  client.obs = {
    call: async (method, params) => {
      calls.push({ method, params });
      return {};
    },
  };

  const clip = { deltaBpm: 12.4, peakBpm: 86.4 };
  const result = await client.onClip(clip);

  assert.equal(result.attempted, true);
  assert.equal(result.replay, 'saved');
  assert.equal(result.chapter, 'created');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'SaveReplayBuffer');
  assert.equal(calls[1].method, 'CreateRecordChapter');
  assert.equal(calls[1].params.chapterName, 'ClipPulse Peak +12.4 BPM');
});

test('onClip formats negative and null deltas accurately without malformed strings', async () => {
  const chapterNames = [];
  const client = new ObsClient();
  client.connected = true;
  client.obs = {
    call: async (method, params) => {
      if (method === 'CreateRecordChapter') chapterNames.push(params.chapterName);
      return {};
    },
  };

  await client.onClip({ deltaBpm: -3.5 });
  await client.onClip({ deltaBpm: 0 });
  await client.onClip({ deltaBpm: null });

  assert.equal(chapterNames[0], 'ClipPulse Peak -3.5 BPM');
  assert.equal(chapterNames[1], 'ClipPulse Peak +0.0 BPM');
  assert.equal(chapterNames[2], 'ClipPulse Peak 0.0 BPM');
});

test('onClip catches and isolates call failures gracefully', async () => {
  const client = new ObsClient();
  client.connected = true;
  client.obs = {
    call: async (method) => {
      if (method === 'SaveReplayBuffer') throw new Error('Replay buffer inactive');
      if (method === 'CreateRecordChapter') throw new Error('Not recording');
    },
  };

  const result = await client.onClip({ deltaBpm: 15.0 });
  assert.equal(result.attempted, true);
  assert.match(result.replay, /failed: Replay buffer inactive/);
  assert.match(result.chapter, /failed: Not recording/);
});

test('refreshStatus queries replay and record state when connected', async () => {
  const client = new ObsClient();
  assert.equal(await client.refreshStatus(), null);

  client.connected = true;
  client.obs = {
    call: async (method) => {
      if (method === 'GetReplayBufferStatus') return { outputActive: true };
      if (method === 'GetRecordStatus') return { outputActive: false };
      return {};
    },
  };

  const status = await client.refreshStatus();
  assert.equal(status.replayActive, true);
  assert.equal(status.recordActive, false);
  assert.equal(client.replayActive, true);
  assert.equal(client.recordActive, false);
});
