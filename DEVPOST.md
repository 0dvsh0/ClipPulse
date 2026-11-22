# ClipPulse — Contactless Biometric OBS Overlay & Deterministic VOD Auto-Clipper

> **Transforming streamer pulse and breathing signals into transparent 60fps OBS HUDs and automated highlight reels — zero wearables, zero facecam required, zero video persistence.**

---

![ClipPulse Studio Demo](clippulse-demo.gif)

<p align="center">
  <img src="gate-preview.png" width="32%" alt="Project Setup" />
  <img src="studio-preview.png" width="32%" alt="Studio Workspace" />
  <img src="export-dialog-preview.png" width="32%" alt="EDL Export Preview" />
</p>

---

## Inspiration

Every gamer, speedrunner, and VTuber knows the feeling: your heart hammers in your chest during a 1v4 clutch, a grueling soulslike boss encounter, or a world-record pace run. That physiological reaction is what makes live streaming electrifying.

Yet sharing that excitement with an audience today is broken:
- **Wearable friction:** Streamers must wear uncomfortable chest straps or smartwatches that disconnect via Bluetooth or run out of battery mid-broadcast.
- **Privacy exposure:** Faceless creators and VTubers are forced to choose between revealing their real facial features or sacrificing biometric audience engagement entirely.
- **Post-stream editing fatigue:** After an 8-hour broadcast, finding the peak reaction moments means scrubbing through hundreds of gigabytes of VOD footage for hours.

We asked: **What if an everyday webcam could measure pulse and breathing cadence completely contactlessly, project a transparent 60fps HUD onto OBS, and automatically cut highlights into industry-standard editing timelines the moment peak reactions occur?**

That vision is **ClipPulse**.

---

## What It Does

ClipPulse is a local-first Electron broadcast companion powered by the **Presage SmartSpectra SDK**:

1. **Contactless Biometric Capture**: Uses remote photoplethysmography (rPPG) to track pulse rate, pulse delta, and breathing cadence directly from optical camera reflections. No wearables, chest straps, or smartwatches required.
2. **Transparent 60fps OBS Overlay**: Serves a dynamic, hardware-accelerated glass HUD at `http://127.0.0.1:4789/overlay` via local loopback. Displays real-time pulse waveforms, breathing rings, confidence indicators, and animated **AUTO-CLIPPED** toast alerts.
3. **Deterministic Hype Detector**: Replaces probabilistic cloud AI with a pure mathematical signal pipeline:
   - 120-second rolling baseline that adapts to the creator's natural resting state.
   - Dynamic outlier rejection (`max(6 BPM, 2.5σ)`) so temporary adrenaline surges never contaminate the baseline.
   - Composite 0–100 Hype Score combining pulse delta (up to 62 pts), rate-of-rise slope (up to 18 pts), breathing cadence deviation (up to 12 pts), and sharp-inhale irregularity (up to 8 pts).
   - Continuous 2.5-second sustain requirement and 30-second cooldown gate to eliminate false triggers.
4. **Instant OBS Studio Integration**: Connects over OBS WebSocket v5 to fire `SaveReplayBuffer` and `CreateRecordChapter` the instant a peak moment is captured.
5. **Universal Video Editor Conformance**:
   - **CMX 3600 EDL**: Generates frame-accurate Edit Decision Lists that import directly into **DaVinci Resolve** and **Adobe Premiere Pro**, automatically laying cut clips end-to-end on the record timeline.
   - **YouTube & Twitch Chapters**: Outputs timestamped chapter lists starting at `00:00`.
   - **Session Telemetry JSON**: Emits structured session analytics adhering to `clippulse.session.v1`.
   - **Conformed Highlight Video Reel**: Bundles a ready-to-watch 30-second highlight reel (`clippulse-highlights.mp4`) cut and assembled by FFmpeg from peak moments.
6. **Strict Privacy Architecture**:
   - Faceless preview enabled by default (heavy 42px silhouette blur) with a 5-second unblur alignment hold.
   - Zero raw video persistence — frames remain in ephemeral volatile memory and are never written to disk or sent across the network.
   - Instant hardware **KILL CAMERA** switch that immediately drops camera media tracks, revokes consent, zeroes telemetry buffers, and returns to the gate screen.
7. **Complete SIMULATOR Mode**: Built-in 10 Hz synthetic signal generator with interactive triggers (**Boss-Fight Spike +18 BPM**, **Gasp / Sharp Inhale**, **Lean Away / Validation Lost**, and **Skip Warmup**), allowing anyone to demo the entire pipeline without a camera or API key.

---

## How We Built It

```text
┌───────────────────────────────── Electron Main Process ─────────────────────────────────┐
│  src/main.js                                                                            │
│   • Camera Permission Interception (file:// only, explicit consent gate)                 │
│   • Pure Deterministic HypeDetector (120s baseline, hysteresis, cooldown)              │
│   • Loopback Static HTTP + WebSocket Server (127.0.0.1:4789)                            │
│   • OBS WebSocket v5 Client (SaveReplayBuffer + CreateRecordChapter)                    │
│   • Multi-Format Exporter (CMX 3600 EDL, YouTube Chapters, Session JSON)                │
└───────────────────────────────▲───────────────────────────────┬─────────────────────────┘
                                │ Numeric Telemetry (IPC)       │ State & Clips (IPC)
                                │                               │
┌───────────────────────────────┴───────────────────────────────▼─────────────────────────┐
│  Studio Control Room (src/renderer)                                                     │
│   • Unity Editor Dark Interface (charcoal #1e1e1e palette, docked panels)               │
│   • Presage SmartSpectra SDK v3.5.0 (renderer MediaStream capture)                     │
│   • Faceless Privacy Preview (blur(42px)) + 5s Alignment Hold                           │
│   • Standalone 16:9 OBS Preview Stage (procedural canvas or local .mp4)                 │
│   • In-App Highlight Reel & NLE Conformance Modal with Stage Playback                   │
└───────────────────────────────────────────────────────────────┬─────────────────────────┘
                                                                │ WebSocket ws://127.0.0.1:4789/ws
┌───────────────────────────────────────────────────────────────▼─────────────────────────┐
│  OBS Browser Source (src/overlay)                                                       │
│   • Transparent 500×200 Glass HUD with 60fps RAF Canvas Waveform                        │
│   • Dynamic Themes (Cyber, Minimal, Compact) + AUTO-CLIPPED Toast Notification          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Runtime & Desktop Shell**: Built with Node 24 LTS and Electron v45, using isolated context bridges (`src/preload.js`) and strict Content Security Policies.
- **Biometric SDK**: Powered by `@smartspectra/node-sdk@3.5.0`. Configured with `enableTelemetry: false`, single-listener event dispatching, and windowed protobuf metrics decoding.
- **User Interface**: Designed with a pure CSS **Unity Editor Dark Theme** (`#1e1e1e` workspace, `#282828` panels, `#3c77b4` blue accents). No heavy third-party UI frameworks, zero runtime CSS-in-JS overhead.
- **Video Processing**: Utilizes FFmpeg for frame-accurate timecode burn-in and highlight reel conforming.
- **Automated Verification**: Engineered with 54 native `node:test` suites covering baseline mathematical models, hysteresis timing, cooldown recovery, CMX 3600 EDL syntax, and overlay socket communication.

---

## Challenges We Overcame

1. **Chromium Background Throttling during Fullscreen Gaming**:
   - *Problem:* When a streamer plays a game, ClipPulse runs unfocused in the background. Chromium aggressively throttles timers in background windows down to 0.24 Hz (1 tick every ~4 seconds). This starved the 10 Hz telemetry loop and prevented the detector's 2.5-second continuous sustain check from ever firing.
   - *Solution:* Configured `backgroundThrottling: false` in the `BrowserWindow` webPreferences, ensuring the deterministic telemetry clock pumps consistently regardless of window focus.

2. **Absolute Privacy for Faceless Creators**:
   - *Problem:* Streamers and VTubers are rightfully cautious about camera access.
   - *Solution:* Enforced privacy by design: the camera preview runs a heavy 42px silhouette blur by default, a momentary pointer hold unblurs for only 5 seconds before automatically snapping back, and an instant **KILL CAMERA** button immediately drops media tracks and purges all RAM buffers.

3. **Preventing Baseline Drift during Long Boss Fights**:
   - *Problem:* A prolonged, high-intensity encounter could pull a naive moving average up to 95 BPM, causing subsequent spikes to go undetected.
   - *Solution:* Implemented dynamic outlier rejection (`max(6 BPM, 2.5σ)`). High readings during peak moments are scored for hype but quarantined from the baseline window.

4. **Strict Creator-First Terminology**:
   - *Problem:* Biometrics can easily slip into clinical jargon.
   - *Solution:* Built an automated vocabulary scanner (`scripts/check-vocabulary.js`) into CI that scans 25 files to guarantee zero prohibited clinical terms in the UI, code comments, and documentation.

---

## Accomplishments That We're Proud Of

- **54/54 Automated Tests Passing**: Comprehensive unit and integration test coverage executing synchronously in under 390ms.
- **True Universal NLE Conformance**: Exported CMX 3600 EDLs conform cleanly in professional editing suites like DaVinci Resolve and Adobe Premiere Pro, matching source timecodes to the exact frame.
- **Zero Raw Video Persistence**: Zero frames saved to disk, zero video sent over sockets.
- **Flawless SIMULATOR Mode**: Judges can test every trigger, watch the pulse waveform react, see clips land on the timeline, and inspect exports in seconds without needing a webcam or API key.
- **Physical Highlight Reel Generation**: Included an actual 30-second stitched highlight video (`demo-assets/clippulse-highlights.mp4`) cut directly by FFmpeg from the EDL timestamps.

---

## What We Learned

- How contactless remote photoplethysmography (rPPG) extracts micro-vascular blood volume pulse waveforms from standard webcam optical sensors.
- How CMX 3600 Edit Decision Lists structure source-in, source-out, record-in, and record-out timecodes for professional post-production workflows.
- How to tune high-framerate HTML5 2D canvas smoothing algorithms to render responsive 60fps telemetry overlays inside OBS Browser Sources.

---

## What's Next for ClipPulse

- **Twitch & YouTube Chat Interactivity**: Twitch Channel Points integration enabling viewers to wager points on whether the streamer's pulse will spike above threshold during high-stakes boss attempts.
- **Direct NLE Plugins**: A DaVinci Resolve Python Studio script and Adobe Premiere Pro CEP extension to import ClipPulse highlights in a single click directly inside the editing timeline.
- **Multi-Creator Squad HUD**: Composite overlay for esports teams and collaborative streams, displaying synchronized pulse deltas across multiple players in real time.

---

## Built With

- **Electron** — Cross-platform desktop shell
- **Presage SmartSpectra SDK** — Contactless optical rPPG pulse & breathing sensing
- **Node.js** — Event-driven loopback server & telemetry engine
- **WebSocket (ws)** — Zero-latency local telemetry broadcasting
- **OBS WebSocket v5** — Automated replay buffer saving and record chapter tagging
- **FFmpeg** — Frame-accurate highlight reel cutting & video conforming
- **HTML5 Canvas & Pure CSS** — Unity Editor dark theme & 60fps glass OBS HUD
