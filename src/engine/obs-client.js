'use strict';

const { OBSWebSocket } = require('obs-websocket-js');

/**
 * Thin, non-fatal OBS WebSocket v5 wrapper.
 *
 * Every call is guarded: OBS not running is a normal state for this app, and
 * a failed replay-buffer save must never break the local clip pipeline.
 */
class ObsClient {
  constructor({ url = 'ws://127.0.0.1:4455', password = '', onStatus = null } = {}) {
    this.url = url;
    this.password = password;
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.obs = null;
    this.connected = false;
    this.lastError = null;
    this.replayActive = null;
    this.recordActive = null;
    this.lastAction = null;
    this.status = 'offline';
  }

  emit(extra = {}) {
    this.onStatus({
      status: this.status,
      connected: this.connected,
      url: this.url,
      error: this.lastError,
      replayActive: this.replayActive,
      recordActive: this.recordActive,
      lastAction: this.lastAction,
      ...extra,
    });
  }

  setStatus(status, extra = {}) {
    this.status = status;
    this.emit(extra);
  }

  async connect(options = {}) {
    if (typeof options.url === 'string' && options.url.trim()) this.url = options.url.trim();
    if (typeof options.password === 'string') this.password = options.password;

    if (this.connected) return { connected: true };
    this.disconnect();

    const obs = new OBSWebSocket();
    this.obs = obs;
    this.setStatus('connecting');

    obs.on('ConnectionClosed', () => {
      this.connected = false;
      this.status = 'disconnected';
      this.emit();
    });

    obs.on('ConnectionError', (err) => {
      this.connected = false;
      this.lastError = err && err.message ? err.message : String(err);
      this.setStatus('error');
    });

    try {
      const info = await obs.connect(this.url, this.password || undefined, { rpcVersion: 1 });
      this.connected = true;
      this.lastError = null;
      this.setStatus('connected', {
        obsWebSocketVersion: info && info.obsWebSocketVersion,
        rpcVersion: info && info.rpcVersion,
      });
      await this.refreshStatus();
      return { connected: true, info };
    } catch (err) {
      this.connected = false;
      this.lastError = err && err.message ? err.message : String(err);
      this.setStatus('error');
      return { connected: false, error: this.lastError };
    }
  }

  async refreshStatus() {
    if (!this.connected || !this.obs) return null;

    try {
      const replay = await this.obs.call('GetReplayBufferStatus');
      this.replayActive = replay && replay.outputActive === true;
    } catch {
      this.replayActive = null;
    }

    try {
      const record = await this.obs.call('GetRecordStatus');
      this.recordActive = record && record.outputActive === true;
    } catch {
      this.recordActive = null;
    }

    this.emit();
    return { replayActive: this.replayActive, recordActive: this.recordActive };
  }

  /**
   * Fire the two OBS actions a clip needs. Returns a plain result object that
   * is safe to store in the clip and broadcast.
   */
  async onClip(clip) {
    if (!this.connected || !this.obs) {
      const result = { attempted: false, replay: 'OBS offline', chapter: 'OBS offline' };
      this.lastAction = result;
      return result;
    }

    let replay = 'not attempted';
    let chapter = 'not attempted';

    try {
      await this.obs.call('SaveReplayBuffer');
      replay = 'saved';
    } catch (err) {
      replay = `failed: ${err && err.message ? err.message : err}`;
    }

    const rawDelta = clip && clip.deltaBpm != null ? Number(clip.deltaBpm) : null;
    const delta = Number.isFinite(rawDelta) ? rawDelta : null;
    const sign = delta != null && delta >= 0 ? '+' : '';
    const deltaStr = delta != null ? delta.toFixed(1) : '0.0';

    try {
      await this.obs.call('CreateRecordChapter', {
        chapterName: `ClipPulse Peak ${sign}${deltaStr} BPM`,
      });
      chapter = 'created';
    } catch (err) {
      chapter = `failed: ${err && err.message ? err.message : err}`;
    }

    const result = { attempted: true, replay, chapter };
    this.lastAction = result;
    this.emit();
    return result;
  }

  disconnect() {
    if (this.obs) {
      try {
        this.obs.disconnect();
      } catch {
        /* already closed */
      }
      try {
        if (typeof this.obs.removeAllListeners === 'function') this.obs.removeAllListeners();
      } catch {
        /* ignore */
      }
    }
    this.obs = null;
    this.connected = false;
    this.replayActive = null;
    this.recordActive = null;
    this.status = 'offline';
    this.emit();
  }
}

module.exports = { ObsClient };
