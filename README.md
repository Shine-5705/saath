# साथ Saath: talk to family in their language

**Live translated calls home for the festive season.** Arjun in Toronto speaks English and Dadi in Lucknow speaks Hindi.
Each of them hears the other in their own language, in a natural Indian voice, with live captions in both languages.

Built at **Festive Hacks × WeAreDevelopers Conference India** (BIEC Bengaluru, 25 Nov 2026) by team **TheAdaply**: Shine Gupta and Akash.

> **Provenance.** Saath builds on our earlier prototype [Shine-5705/Live-Call-Tranlation](https://github.com/Shine-5705/Live-Call-Tranlation),
> an Android and Twilio app that ran an STT → translate → TTS pipeline between two phone-call legs (Deepgram, Gemini and Google TTS).
> We kept its design: per-speaker pipelines, translations injected only into the other person's leg, and a caption state per turn.
> **Added today at Festive Hacks:** a new web app and zero-dependency Node backend (no code copied from the Kotlin or TypeScript prototype);
> a full switch to **Sarvam AI** (saarika STT with automatic language detection, mayura translation, bulbul v3 voices) covering 11 Indian languages;
> rooms with live captions over SSE; a per-stage latency readout; **Flagsmith** feature flags and remote config;
> a container, Kubernetes manifest and metrics for **NudgeBee**; and the demo-recording scripts.

## Why

Diwali, weddings and Chhath are when families call home the most. A lot of those calls are between a grandchild who grew up
speaking English (or Tamil, or Kannada) and a grandparent who is most comfortable in Hindi, Bengali or Punjabi. The love is
there, but the vocabulary isn't. Saath puts a fluent interpreter on the call.

## Demo

- Video (under 2 min, real Sarvam output, with audio): see the [release](https://github.com/Shine-5705/saath/releases/latest) or [`docs/saath-demo.mp4`](docs/saath-demo.mp4)
- Frontend: https://shine-5705.github.io/saath/. GitHub Pages only hosts static files, so the page talks to a backend at `http://localhost:8797`.
  Run the backend locally (below) or pass `?api=https://your-backend`.

In the demo video, the *input* speech for both people was generated with Sarvam bulbul TTS (`scripts/make-demo-audio.py`)
because the recording machine has no microphone. Everything after that is the live pipeline: transcription, translation,
the spoken translation, the captions and the latency numbers.

## Quick start

```bash
git clone https://github.com/Shine-5705/saath && cd saath
cp .env.example .env         # add SARVAM_API_KEY (required); Flagsmith and NudgeBee are optional
npm start                    # → http://localhost:8797
```

Open the page, click **Start a call**, pick a language for each person, and hold **Hold to talk** to speak.
To call from two devices, open the same `?room=<id>#call` URL on both. Each device can use either side.
Node 20.6 or newer; there are no npm dependencies.

## How it works

```
 Browser (push-to-talk, MediaRecorder)            Browser (other person)
        │ POST /api/room/:id/turn?from=a                 ▲  SSE /api/room/:id/events
        ▼                                                │  captions + translated voice
 server.js ── Sarvam saarika:v2.5  speech-to-text (language_code=unknown → auto-detect)
           ── Sarvam mayura:v1     translate speaker language → listener language
           ── Sarvam bulbul:v3     text-to-speech in the listener's language (voice matches the speaker)
           ── Flagsmith            GET /api/v1/flags/ (15 s cache, safe defaults)
           ── NudgeBee             JSON-RPC recommendations_list via /api/ops
           └─ /healthz · /metrics  (Kubernetes probes, Prometheus, NudgeBee agent)
```

To flip a flag from the terminal: `FLAGSMITH_TOKEN=<admin api key> FLAGSMITH_ENV_ID=<id> FLAGSMITH_ENVIRONMENT_KEY=<key> python3 scripts/flag-toggle.py latency_badge off`.

Each caption shows the original sentence, the translation, and the time spent in STT, translation and voice, plus the total.
The header shows the latest latency and the running average.

## Sponsor tools

**Sarvam AI** is the whole speech and language layer.
- `saarika:v2.5` speech-to-text auto-detects the speaker's language, so a grandparent never has to pick a setting.
- `mayura:v1` handles translation. We tried `sarvam-translate:v1` first, but on our colloquial Hindi test sentence `mayura:v1` stayed closer to the meaning, so it's the default (configurable through `SARVAM_MT_MODEL`).
- `bulbul:v3` speaks the translation, with a different voice for each speaker.

**Flagsmith** controls the call experience without a redeploy, and it's **live** in the demo. The server reads our Flagsmith Development environment through the Edge API (`/api/v1/flags/`, 5 s cache) and the UI re-reads the config every 2 s. In the demo video, `latency_badge` is switched off and back on through the Flagsmith Admin API (`scripts/flag-toggle.py`, which uses the v2 feature-versioning endpoint), and the running call's latency readouts disappear and come back with no redeploy. If `FLAGSMITH_ENVIRONMENT_KEY` isn't set, the server uses the same values as safe defaults:

| Feature | Type | Default | Effect |
|---|---|---|---|
| `voice_out` | flag | on | Speak the translation with bulbul (off → captions only, cheaper on poor networks) |
| `auto_detect_language` | flag | on | saarika `language_code=unknown` vs the speaker's chosen language |
| `latency_badge` | flag | on | Per-turn latency breakdown and header latency chip |
| `languages` | remote config | 11 languages | Languages offered in the pickers |
| `max_turn_seconds` | remote config | 25 | Reserved for capping a turn's length |

**NudgeBee** handles operations. `Dockerfile`, `.github/workflows/container.yml` (an image on GHCR) and `deploy/k8s/saath.yaml`
(probes, resource limits, Prometheus annotations) let you run Saath on a cluster with the NudgeBee agent, which then watches
its events, restarts, probe failures and resource use. `/metrics` exposes turn counts, per-stage latency sums and Sarvam
error counts. When `NUDGEBEE_API_TOKEN` is set, `/api/ops` pulls NudgeBee recommendations through its API.

## Honest status

- Sarvam integration: **live** in the demo.
- Flagsmith: **live**. The five features exist in our Flagsmith project, and the demo shows a real flag flip changing the UI.
- NudgeBee: deploy artefacts and API hook are in place. We **did not** run it on a NudgeBee-monitored cluster today.
- No accuracy or usage metrics are claimed. The latency numbers on screen are real measurements from one run on our recording machine.

## License
MIT © 2026 Shine Gupta and Akash (TheAdaply)
