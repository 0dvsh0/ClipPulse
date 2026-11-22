# ClipPulse — Project Context

> Canonical engineering context for this repository. Read this before changing code.
> Last verified: 2026-11-21 against `@smartspectra/node-sdk@3.5.0`.

---

## 1. Product

**One line:** Contactless biometric OBS Studio overlay + deterministic VOD auto-clipper powered by the Presage SmartSpectra SDK. No chest strap, no smartwatch, no facecam required, and no raw video ever leaves the machine.

**Primary user:** gameplay streamer, speedrunner, VTuber, or faceless creator who wants reaction-aware highlights without a facecam or wearable.

**Hard constraints**

- Ship clean and runnable over scope. Windows 11 first; macOS/Linux compatible where the SDK supports it.
- Node.js 20+ (Node 24 LTS recommended). Electron 45.x in this repo.
- Zero LLM calls. The clipper is a deterministic signal pipeline.
- Zero raw-video persistence. Metric buffers live in RAM and are cleared on session end / app exit.
- Zero medical vocabulary in UI, code comments, exports, and docs. Use creator/mechanical terms only:
  `Pulse`, `Pulse Delta`, `Baseline BPM`, `Breathing Cadence`, `Hype Intensity`, `Peak Moment`, `Signal Confidence`, `Validation State`.
- OBS overlay must be transparent and usable as a Browser Source at `http://127.0.0.1:4789/overlay`.
- Loopback only. HTTP + WebSocket bind strictly to `127.0.0.1:4789`. Telemetry is numeric JSON only.

**Non-goals**

- No cloud accounts, analytics, remote logging, or third-party AI services.
- No diagnostic, treatment, or medical claims.
- No covert or third-party monitoring. The app is an entertainment/creator tool.
- No video recording, screenshots, or frame export.

---

## 2. Verified SDK Surface (Phase 0 result)

Installed package: `@smartspectra/node-sdk@3.5.0` (`node_modules/@smartspectra/node-sdk`).
Native runtime loaded successfully on this Windows x64 host; `SmartSpectraSDK.availableCameras()` returned the installed camera.

### 2.1 Entry points

| Entry | Purpose |
| --- | --- |
| `@smartspectra/node-sdk` | Low-level SDK, main process / headless |
| `@smartspectra/node-sdk/main` | `bindSmartSpectraIpc(window)` — hosts one SDK per renderer connection |
| `@smartspectra/node-sdk/preload` | Preload bridge (`window.__smartspectraBridge`) |
| `@smartspectra/node-sdk/renderer` | Renderer-side `SmartSpectraSDK` using `MediaStream` + `MediaStreamTrackProcessor` |
| `@smartspectra/node-sdk/messages` | `decodeMetrics(buf)` + generated protobuf classes |

### 2.2 Constructor options (exact)

```ts
new SmartSpectraSDK({
  apiKey: string,
  requestedMetrics: number[],          // MetricType codes
  enableAccumulatedOutput?: boolean,   // default false
  logLevel?: number,                   // renderer IPC glue drops this; omit
  enableTelemetry?: boolean,           // set false explicitly
  sendTimeoutMs?: number,              // renderer only, default 30000
});
```

`enableTelemetry: false` is honored through the renderer IPC glue (`js/main/index.js` sanitizeOptions).
`enableAccumulatedOutput` is forced to a boolean and should stay `false`; the app appends windowed `metrics` slices itself.

### 2.3 Metric bundles (exact values)

```js
breathingMetrics = [0, 1, 2]       // CHEST_BREATHING, ABDOMEN_BREATHING, BREATHING_RATE
cardioMetrics    = [15, 16, 17]    // PULSE_RATE, ARTERIAL_PRESSURE_TRACE, HRV
faceMetrics      = [11, 12, 13, 14] // FACE_LANDMARKS, BLINKING, TALKING, EXPRESSIONS
```

Requested bundles in ClipPulse:

- Always: `...breathingMetrics, ...cardioMetrics`
- Opt-in (default off): `...faceMetrics` when `Enable Facial Expression Boost` is on.

### 2.4 Events (renderer SDK)

```ts
sdk.on('processingStatus', (status) => {})                       // 0..5
sdk.on('validationStatus', (code, timestampUs, hint) => {})      // see codes below
sdk.on('metrics', (buf: Uint8Array, timestampUs) => {})          // WINDOWED slice, decode it
sdk.on('frameSentThrough', (sent: boolean, timestampUs) => {})   // true camera FPS counter
sdk.on('streamAvailable', (stream: MediaStream) => {})           // SDK-acquired camera stream
sdk.on('error', (code, message, retryable) => {})
```

**Critical:** each event supports exactly one listener; re-registering replaces the previous callback. The app must register one listener per event, once, and fan out internally.

**Critical:** `metrics` delivers the slice since the previous emit, not the cumulative session. Append to local rolling buffers; do not treat the packet as a full history.

### 2.5 ProcessingStatus

```
kUninitialized 0, kIdle 1, kStarting 2, kRunning 3, kStopping 4, kError 5
```

### 2.6 ValidationCode

```
kOk 0
kNoFaceFound 1
kMultipleFacesFound 2
kFaceNotCentered 3
kFaceSizeOutOfRange 4 (deprecated)
kTooDark 5
kTooBright 6
kChestNotVisible 7
kCameraTuning 10
kFrameRateTooLow 11
kExcessiveMotion 12
kFaceTooClose 13
kFaceTooFar 14
kFaceTooHigh 15
kFaceTooLow 16
kFaceNotForward 17
```

Validation state mapping used by ClipPulse:

| Code | UI state | Clipping allowed |
| --- | --- | --- |
| 0 | `TRACKING LOCKED` | yes |
| 10 | `CAMERA TUNING` | no (warm-up) |
| 1 | `NO FACE DETECTED` | no |
| 2 | `MULTIPLE FACES` | no |
| 3, 13, 14, 15, 16, 17 | `ALIGNMENT` | no |
| 5, 6 | `LIGHTING` | no |
| 11 | `FRAME RATE LOW` | no |
| 12 | `MOTION` | no |
| 4, 7 | `SIGNAL BLOCKED` | no |

### 2.7 Decoded metric shape

`decodeMetrics(buf)` returns `presage.smartspectra.Metrics`:

```ts
Metrics {
  breathing?: {
    rate?: MeasurementWithConfidence[];        // { value, confidence 0..100, stable, timestamp (µs) }
    upperTrace?: Measurement[];                // { value, stable, timestamp (µs) }
    lowerTrace?: Measurement[];
    amplitude?: Measurement[];                 // unavailable
    apnea?: DetectionStatus[];                 // unavailable
    respiratoryLineLength?: Measurement[];     // unavailable
    baseline?: Measurement[];                  // unavailable
    inhaleExhaleRatio?: Measurement[];         // unavailable
  };
  cardio?: {
    pulseRate?: MeasurementWithConfidence[];   // { value, confidence 0..100, stable, timestamp }
    arterialPressureTrace?: MeasurementWithConfidence[]; // unitless waveform
    hrv?: Hrv[];                               // not used
    pulseRateStrict?: Strict;                  // not used
  };
  face?: {
    blinking?: DetectionStatus[];
    talking?: DetectionStatus[];
    landmarks?: Landmarks[];
    expression?: Expression[];                 // { stable, timestamp, scores: [{ type, confidence 0..100 }] }
  };
}
```

`ExpressionType`: `UNSPECIFIED 0, ANGRY 1, CONTEMPT 2, DISGUST 3, FEAR 4, HAPPY 5, NEUTRAL 6, SAD 7, SURPRISE 8`.

Timestamps may be `number` or a protobuf `Long`. Normalize with `toNumber()` when present.

### 2.8 Camera / Electron integration

Chosen path: **renderer-side SDK** (`@smartspectra/node-sdk/renderer`) — the documented Electron workflow.

- Main creates the window with `sandbox: false`, `contextIsolation: true`, `nodeIntegration: false`.
- Main calls `bindSmartSpectraIpc(win)`.
- `src/preload.js` requires `@smartspectra/node-sdk/preload` and exposes the ClipPulse bridge.
- Renderer constructs the SDK, calls `start()`, receives `streamAvailable`, and attaches the stream to the privacy preview `<video>`.
- SDK-acquired stream tracks are stopped by `sdk.stop()` / `sdk.destroy()`, releasing the camera indicator.

Why not main-process `useCamera()`: the renderer path is the documented Electron path, provides the `MediaStream` for the blurred alignment preview, and keeps camera lifecycle next to the UI that must stop it. Video stays inside the renderer process and is never forwarded.

### 2.9 `videoOutput`

`videoOutput` is opt-in by registering a listener. ClipPulse **never registers it**, so the SDK does not deliver processed image callbacks to the app. This keeps the telemetry path lightweight and guarantees no frame buffer reaches application code.

### 2.10 OBS WebSocket v5

Package: `obs-websocket-js@5.0.8`.

Confirmed request names:

- `SaveReplayBuffer` (no params)
- `CreateRecordChapter` (`{ chapterName?: string }`)
- `GetReplayBufferStatus`

ClipPulse calls both on a clip trigger when connected. Every OBS failure is non-fatal and surfaced as a status badge.

---

## 3. Architecture

```text
┌──────────────────────────── Electron main process ────────────────────────────┐
│  src/main.js                                                                  │
│   • consent state + camera permission gate                                    │
│   • HypeDetector (pure) + clip list + session clock                           │
│   • OverlayServer: HTTP + WS on 127.0.0.1:4789                                 │
│   • ObsClient (optional, 127.0.0.1:4455)                                      │
│   • exporter: .edl / .txt / .json                                             │
│   • IPC: consent, session, telemetry, settings, export, kill                  │
│                                                                               │
│  @smartspectra/node-sdk/main: bindSmartSpectraIpc(win)                        │
└───────────────▲───────────────────────────────────────────┬───────────────────┘
                │ numeric telemetry (IPC)                   │ state + clips (IPC)
                │                                           │
┌───────────────┴───────────────────────────────────────────▼───────────────────┐
│  Renderer (src/renderer)                                                      │
│   • Consent Gate → Studio Control Room                                        │
│   • SignalProvider (LIVE renderer SDK / SIMULATOR)                            │
│   • blurred privacy preview + alignment hold                                  │
│   • standalone OBS preview stage (procedural canvas or local .mp4)            │
│   • iframe: http://127.0.0.1:4789/overlay?theme=cyber&preview=1                │
│   • hype meter, clip timeline, inspector, export UI                           │
└───────────────────────────────────────────────────────────────────────────────┘
                │ WebSocket ws://127.0.0.1:4789/ws (JSON only)
┌───────────────▼───────────────────────────────────────────────────────────────┐
│  OBS Browser Source / any browser tab                                         │
│   src/overlay: transparent 60fps canvas ECG HUD, BPM, delta, breath ring,     │
│   validation pill, AUTO-CLIPPED toast. Themes: cyber / minimal / compact.      │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Module map

| File | Responsibility |
| --- | --- |
| `src/main.js` | App lifecycle, window, consent enforcement, IPC, engine wiring, exports, kill switch |
| `src/preload.js` | Requires SDK preload; exposes `window.clippulse` context bridge |
| `src/engine/signal-provider.js` | Renderer-side LIVE SDK wrapper + SIMULATOR; one listener per event; decode + normalize + throttle |
| `src/engine/hype-detector.js` | Pure deterministic baseline + hype score + hysteresis + clip objects |
| `src/engine/exporter.js` | Pure CMX 3600 EDL, YouTube/Twitch chapters, structured JSON |
| `src/engine/obs-client.js` | OBS WebSocket v5 connect + SaveReplayBuffer + CreateRecordChapter |
| `src/server/overlay-server.js` | Loopback HTTP static server + WS broadcast hub |
| `src/renderer/app.js` | UI controller; bundled by esbuild to `dist/renderer.js` |
| `src/renderer/index.html`, `styles.css` | Consent Gate + Studio Control Room, pure CSS |
| `src/overlay/*` | Transparent Browser Source HUD (plain JS/CSS, no build step) |
| `test/*.test.js` | `node:test` deterministic proofs |

---

## 4. Data Contracts

### 4.1 Renderer → main telemetry frame

Sent at most 10 Hz. All fields sanitized in main before use.

```ts
{
  t: number,                    // Date.now() ms
  mode: 'live' | 'simulator',
  bpm: number | null,
  breathRate: number | null,
  confidence: number,           // 0..1
  stable: boolean,
  validationCode: number,
  validationState: string,      // display label
  validationHint: string,
  packetCount: number,          // decoded metrics packets this session
  fps: number,                  // frameSentThrough rate (or simulated 30)
  pulseTrace: number[],         // normalized 0..1, max 160
  breathTrace: number[],        // normalized 0..1, max 80
  expression: null | { surprise: number, happy: number, fear: number }, // 0..1
}
```

### 4.2 Main → overlay WS state

```ts
{
  type: 'state',
  v: 1,
  t: number,
  mode: 'LIVE' | 'SIMULATOR' | 'IDLE',
  status: 'idle' | 'warmup' | 'live' | 'error',
  bpm: number | null,
  baselineBpm: number | null,
  deltaBpm: number | null,
  breathRate: number | null,
  baselineBreathRate: number | null,
  confidence: number,
  stable: boolean,
  validationState: string,
  validationCode: number,
  hypeScore: number,            // 0..100
  threshold: number,
  baselineReady: boolean,
  warmupRemaining: number,      // ms
  cooldownRemaining: number,    // ms
  packetCount: number,
  fps: number,
  sessionSec: number,
  pulseTrace: number[],
  breathTrace: number[],
  expressionBoost: boolean,
  expression: object | null,
}
```

Clip message:

```ts
{
  type: 'clip',
  clip: {
    id: string,
    index: number,
    mode: 'live' | 'simulator',
    triggerAtMs: number,
    startMs: number,
    endMs: number,
    startSec: number,
    endSec: number,
    peakBpm: number,
    baselineBpm: number,
    deltaBpm: number,
    breathRate: number | null,
    hypeScore: number,
    confidence: number,
    reason: string,
    preRollSec: number,
    postRollSec: number,
    obs: { attempted: boolean, replay: string, chapter: string } | null,
  }
}
```

Only numeric telemetry and short display strings cross the loopback socket. No frames, no images, no API keys, no file paths.

### 4.3 Clip export shapes

**CMX 3600 `.edl`**

```text
TITLE: CLIPPULSE HIGHLIGHTS
FCM: NON-DROP FRAME

001  AX       V     C        00:00:12:00 00:00:42:00 00:00:00:00 00:00:30:00
* FROM CLIP NAME: ClipPulse Peak 1 - +14.2 BPM
* COMMENT: +14.2 BPM spike + rapid breath

002  AX       V     C        00:01:40:00 00:02:10:00 00:00:30:00 00:01:00:00
* FROM CLIP NAME: ClipPulse Peak 2 - +9.1 BPM
* COMMENT: rapid breath
```

**YouTube / Twitch chapters `.txt`**

```text
00:00 Session Start
00:12 Peak Moment 1 - +14.2 BPM
01:40 Peak Moment 2 - +9.1 BPM
```

**Session `.json`**

```json
{
  "schema": "clippulse.session.v1",
  "mode": "live",
  "startedAtMs": 0,
  "endedAtMs": 0,
  "durationSec": 0,
  "config": { "threshold": 70, "sustainMs": 2500, "cooldownMs": 30000, "preRollSec": 20, "postRollSec": 10 },
  "clips": [],
  "summary": { "clipCount": 0, "peakBpm": 0, "peakDeltaBpm": 0, "avgHypeScore": 0 }
}
```

---

## 5. Hype Detector (deterministic, zero LLM)

### 5.1 Baseline

- Warm-up: `warmupMs` (live 20 000 ms, simulator 12 000 ms) **or** a stable signal with enough samples, whichever comes first.
- Rolling window: 120 000 ms.
- Only high-confidence, valid frames enter the baseline: `confidence >= 0.40` and `validationCode === 0`.
- Outlier rejection once ready: skip samples farther than `max(6 BPM, 2.5 × baselineStd)` from the current mean, so a short spike cannot wash out the baseline.
- Baseline outputs: `baselineBpm` (mean), `baselineStd` (population standard deviation), `baselineBreathRate` (mean).
- `skipWarmup()` exists for SIMULATOR only: seeds the baseline from current samples (or 74 BPM / 3 std / 14 br/min) so a judge can demo immediately.

### 5.2 Score (0–100)

```text
pulseDelta   = currentBpm - baselineBpm
pulseSlope   = least-squares d(bpm)/dt over the last 5 s (BPM/s)

deltaScore    = clamp(pulseDelta / 16, 0, 1) * 62
slopeScore    = clamp(pulseSlope / 2.0, 0, 1) * 18
breathScore   = clamp((abs(breathRate - baselineBreathRate) - 1) / 7, 0, 1) * 12
irregularity  = sharp-inhale z-score from breathing upperTrace (last ~4 s)
irregularityScore = clamp(irregularity / 1.5, 0, 1) * 8
expressionScore   = opt-in: 12 if max(SURPRISE, HAPPY, FEAR) >= 0.60, else 6 if >= 0.40

hypeScore = clamp(deltaScore + slopeScore + breathScore + irregularityScore + expressionScore, 0, 100)
```

`irregularity` algorithm (pure, testable): take the last 40 normalized breath-trace points, compute first differences, take the standard deviation of differences, then `max(0, (maxPositiveDiffInLast12 - 1.5 × stdDiff) / stdDiff)`.

Score is 0 while the baseline is not ready, or while validation is not `kOk`, or while confidence is below 0.40.

### 5.3 Trigger gate (anti-spam)

A clip fires only when **all** are true:

1. `baselineReady`
2. `validationCode === kOk`
3. `confidence >= 0.40`
4. `hypeScore >= threshold` continuously for `sustainMs` (default 2 500 ms)
5. `cooldownMs` (default 30 000 ms) elapsed since the last trigger
6. detector is armed — after a trigger it re-arms only when the score drops below `threshold - 5`

Trigger output: `[t - 20 s pre-roll, t + 10 s post-roll]`, peak BPM during the sustain window, delta vs baseline, reason string.

Reason examples (mechanical only):

- `+14.2 BPM spike + rapid breath`
- `+9.1 BPM spike + rising 1.2 BPM/s + sharp inhale`
- `+18.0 BPM spike + expression burst`

### 5.4 Config defaults

| Setting | Default | UI range |
| --- | --- | --- |
| Hype threshold | 70 | 40–95 |
| Sustain | 2 500 ms | 1 000–6 000 ms |
| Cooldown | 30 000 ms | 10 000–120 000 ms |
| Pre-roll | 20 s | fixed |
| Post-roll | 10 s | fixed |
| Min confidence | 0.40 | fixed |
| Expression boost | off | toggle, next live session |
| Baseline window | 120 s | fixed |

---

## 6. Privacy / Security Invariants

1. **Consent first.** The camera permission handler returns `true` only when `consentActive === true`, the requesting URL is the bundled `file://` page, and the request is video-only. Consent is set only by the explicit checkbox. `KILL CAMERA` sets it false immediately.
2. **No video persistence.** No `fs` writes of frames, no screenshots, no `canvas.toDataURL`, no recording. The preview `<video>` is a live sink only.
3. **No video over the wire.** The overlay HTTP/WS server serves static HUD assets and numeric JSON only. It never receives or transmits frames.
4. **Loopback only.** `server.listen(4789, '127.0.0.1')`. No `0.0.0.0`.
5. **RAM only.** Metric buffers, traces, baseline, and clips are in memory. Session stop clears traces/baseline; kill clears everything. Window close clears everything.
6. **API key.** Loaded from `SMARTSPECTRA_API_KEY` in `.env` or entered at runtime. Runtime keys are kept in main-process memory only. Never written to disk, never logged, never sent over WS. The key reaches the renderer only after consent, solely to construct the SDK.
7. **Telemetry off.** `enableTelemetry: false` is passed explicitly. No device-readiness call, no Insights/LLM call.
8. **No remote content.** `will-navigate` is blocked; `setWindowOpenHandler` denies popups. The only iframe is the loopback overlay. External links go through an allowlisted `shell.openExternal`.
9. **SDK network disclosure.** The SDK still contacts Presage servers for API-key authentication, entitlement/credit verification, and SDK-managed session metadata as governed by Presage's privacy policy. ClipPulse adds no other network calls.
10. **Vocabulary guard.** UI, comments, exports, and docs never use the six prohibited terms from the brief. A grep check is part of the final verification.

---

## 7. Build / Run

```bash
npm install
cp .env.example .env        # add SMARTSPECTRA_API_KEY
npm test                    # node:test — detector + exporter
npm start                   # builds renderer bundle, launches Electron
```

Windows note: VS Code terminals may set `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain Node and fail. `scripts/start.js` deletes that variable before spawning Electron and prints a warning. `npm start` is always the safe entry point.

`npm run dev` opens DevTools.

### Build pipeline

- `scripts/build.js` uses esbuild to bundle `src/renderer/app.js` → `dist/renderer.js` (IIFE, browser, sourcemap).
- Main, preload, engine, server, and overlay are plain CommonJS / static files — no bundling needed.
- `dist/` is generated and gitignored.

### Electron window

- `sandbox: false` is required so `src/preload.js` can `require('@smartspectra/node-sdk/preload')`.
- `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`.
- CSP allows `worker-src blob:` (SDK frame pump), `frame-src http://127.0.0.1:4789` (standalone stage), `media-src blob:` (user-dropped local video preview).

---

## 8. Testing Plan

`npm test` runs `node --test test/*.test.js` with no Electron dependency.

Coverage:

1. Baseline mean/std math; low-confidence frames ignored; outlier rejection.
2. Hysteresis: 2.5 s continuous breach required; a 2 s spike does not fire.
3. Cooldown: second trigger inside 30 s suppressed; trigger after cooldown fires.
4. Validation / confidence gating: invalid frames never fire and reset the sustain timer.
5. Expression boost adds points only when enabled and confidence is high.
6. `formatTimecode` / `formatChapterTime` edge cases.
7. EDL: header, event numbering, source and record timecodes, clip names.
8. Chapters: `00:00` first line, chronological labels, no duplicate times.
9. JSON: schema, numeric timestamps, summary math, no prohibited vocabulary.
10. Reason string composition and ordering.

Manual verification:

1. `npm test` green.
2. `GET http://127.0.0.1:4789/overlay` loads in a browser; WS frames update the HUD.
3. Consent unchecked → Start Live disabled and main denies camera permission.
4. Start simulator → triggers produce clips, exports open, overlay toast fires.
5. Start live → blurred preview, `TRACKING LOCKED`, packet counter climbs, lean-out flips validation.
6. `KILL CAMERA` → camera LED off, status IDLE, buffers zeroed, clips cleared.
7. OBS Browser Source at 500×200 shows the transparent HUD; OBS WebSocket fires replay + chapter.
8. Export `.edl` imports into DaVinci Resolve / Premiere Pro.

---

## 9. Simulator Mode (credit saver / judge mode)

Clearly badged `SIMULATOR MODE — NO LIVE CAMERA` in the control room and overlay.

Synthetic 10 Hz frames: baseline ~74 BPM, breathing ~14 br/min, ECG-shaped trace, breath trace, confidence ~0.92, validation `kOk`.

Controls:

- `Boss-Fight Spike +18 BPM` — 3 s rise, ~4 s hold, 3 s fall; also raises breathing cadence.
- `Gasp / Surprise` — sharp inhalation peak in the breath trace for ~5 s.
- `Lean Away / Validation Lost` — `kNoFaceFound`, confidence 0, for ~4 s; detector pauses.
- `Skip Warmup` — seeds the baseline so a trigger can fire immediately.
- `Reset Sim` — returns to baseline.

Simulator never calls `getUserMedia` and never touches the camera.

---

## 10. Known Risks / Decisions

| Risk | Mitigation |
| --- | --- |
| No Presage key during development | SIMULATOR mode exercises the full pipeline; LIVE path is code-complete and type-verified against 3.5.0 |
| Camera busy / denied | Clear error banner with SDK code + hint; no crash |
| OBS not running | Every OBS call is try/catch; badge shows `OBS OFFLINE`; clips still export |
| Port 4789 busy | Server start error surfaced in the UI with the exact URL and port |
| `metrics` packets are windowed | SignalProvider appends to rolling buffers; never assumes cumulative |
| Long spikes contaminating baseline | Outlier rejection beyond `max(6, 2.5σ)` |
| Windows `ELECTRON_RUN_AS_NODE` | `scripts/start.js` clears it |
| Renderer SDK requires worker | CSP includes `worker-src 'self' blob:`; `sandbox: false` for preload require |
| Face preview privacy | Default `blur(42px)` + grayscale + dark veil; alignment hold limited to 5 s; preview toggle can switch to numeric-only |

---

## 11. Definition of Done

- [x] Phase 0 SDK inspection recorded (this file)
- [x] `npm install` clean
- [x] `npm test` all green
- [x] Consent Gate blocks camera until checked
- [x] Live SDK path wired with one listener per event, `enableTelemetry: false`, no `videoOutput`
- [x] Simulator path with three triggers + skip warmup
- [x] Hype detector baseline / score / hysteresis / cooldown / validation gating
- [x] Overlay server on `127.0.0.1:4789`, `/overlay`, `/ws`, themes
- [x] Transparent 60fps overlay HUD with AUTO-CLIPPED toast
- [x] Studio Control Room: privacy bar, kill switch, blurred preview + alignment hold, standalone stage, inspector, hype meter, timeline
- [x] Clip exports `.edl`, `.txt`, `.json`
- [x] OBS WebSocket v5 SaveReplayBuffer + CreateRecordChapter
- [x] `KILL CAMERA` releases camera and clears RAM buffers
- [x] README with prerequisites, Windows note, 3-step run, OBS setup, consent/data disclosure
- [x] Prohibited-vocabulary grep clean
