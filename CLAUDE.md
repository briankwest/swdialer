# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

iPhone-style web dialer using SignalWire's Fabric/WebRTC stack. Two services:

- `backend/` — Flask app on port **5001**. Mints SignalWire subscriber tokens and keeps an in-memory log of calls. It does **not** route media or signaling.
- `frontend/` — Vite + React + TypeScript on port **5173**. All WebRTC (signaling, media, DTMF) goes through the **published npm package** `@signalwire/js` (pinned to `4.0.0-rc.0` in `frontend/package.json`) directly from the browser. There is **no** local SDK alias — `vite.config.ts` resolves `@signalwire/js` from `node_modules` like any other dependency. Note: `4.0.0-rc.0` is the current `latest`/`rc` on npm and what the CDN (`https://cdn.signalwire.com/@signalwire/js`) serves; there is no stable `4.0.0` yet.
- `signalwire-js/` — a local checkout of the SignalWire Browser SDK monorepo at the same `4.0.0-rc.0` version. It is **not** wired into the dialer build (we consume the npm package); keep it for reference only — its `examples/` directory is the authoritative guide to the v4 API, and `packages/main/src/` is the SDK source if you need to read it. (It replaced the old `browser-sdk/` alias, which is gone.)

## Commands

A `venv` lives at the repo root (`/venv`). Always activate it before running Python: `source venv/bin/activate`.

```bash
# Backend (from repo root)
source venv/bin/activate
cd backend && python app.py            # dev server on :5001

# Frontend
cd frontend
npm install
npm run dev                            # Vite dev server on :5173 (proxies /api → :5001)
npm run build                          # tsc + vite build
npm run lint                           # eslint
```

There are no tests in this repo.

`backend/.env` holds `SPACE_NAME`, `PROJECT_ID`, `AUTH_TOKEN`, `PORT`, and `FRONTEND_URL`. `vite.config.ts` reads `FRONTEND_URL` from `backend/.env` to add its hostname to `allowedHosts` — useful for ngrok/tunneled dev.

## Architecture notes that aren't obvious from the file tree

**Token lifecycle.** Backend `/api/auth/token` and `/api/auth/refresh` both call `SignalWireClient.create_subscriber_token` — refresh just mints a fresh one. The frontend never stores tokens; instead `signalwire.ts` passes a `credentialProvider` with `authenticate`/`refresh` callbacks to `new SignalWire(...)`, and the SDK calls them on demand (~80% of TTL). Don't add token caching on the frontend. The backend mints a **plain SAT** (no `sat:refresh` scope, no DPoP fingerprint), so the SDK relies on our developer `refresh()` callback rather than the Client Bound SAT path — that's expected. `signalwire.ts` subscribes to `client.warnings$` (added in `4.0.0-rc.0`): `credential_refresh_fallback`/`credential_no_refresh_handler` warnings there are the signal that token refresh isn't wired up correctly. (Optional future hardening: forward the `AuthenticateContext.fingerprint` from `authenticate(context)` to the backend with `scope: "sat:refresh"` to enable automatic Client Bound SAT refresh.)

**Call state is split across three places, deliberately:**
- `SignalWireService` (`frontend/src/services/signalwire.ts`) owns the SDK `Call` objects. It distinguishes `pendingCall` (ringing, not yet answered) from `currentCall` (active). Incoming calls that arrive while `currentCall` is set are auto-rejected.
- `useCallStore` (Zustand) holds UI state — `isInCall`, `isIncoming`, `callStatus`, mute/speaker flags.
- `useSignalWire` is the bridge: it wires SDK callbacks (`onIncomingCall`, `onCallEnded`, `onCallConnected`) into store updates.

**The SignalWire singleton must outlive React unmounts.** `useSignalWire`'s cleanup deliberately does **not** call `signalWireService.disconnect()` — only `App.tsx`'s `beforeunload` listener does. React StrictMode / re-renders would otherwise tear down the registration mid-call. If you need to "reset" the SDK, reload the page; don't try to re-initialize.

**Remote audio has a fallback path.** `remoteStream$` from the SDK isn't always reliable, so `setupRemoteAudioFallback` polls `(call as any).rtcPeerConnection` and attaches a `track` listener directly. Both paths feed `playRemoteStream`, which renders into a single `<audio id="sw-remote-audio">` element appended to `document.body`. Don't remove the fallback without verifying audio still works on both inbound and outbound calls.

**Call-ended detection is also redundant.** The SDK's `status$` can fail to emit `disconnected` on certain failures, so `monitorPeerConnection` also treats `iceConnectionState` of `closed`/`failed` and `connectionState` of `closed`/`failed` as call-ended. `endCall()` eagerly calls `handleCallEnded()` before awaiting `call.hangup()` for the same reason — don't reorder.

**Backend "call tracking" is cosmetic.** `active_calls`/`call_history` in `backend/api/calls.py` are module-level dicts/lists. They don't drive any SDK behavior; they exist for the optional `/api/calls/*` endpoints. The frontend posts to `/api/calls/dial` for logging only — the actual dial happens via `client.dial()` in the browser. Treat the backend call store as ephemeral debugging data, not source of truth.

## Conventions

- The `signalwire-js/` checkout has its own `CLAUDE.md` (e.g. `signalwire-js/packages/main/CLAUDE.md`) — those rules apply when editing files **inside** `signalwire-js/`, not to the dialer code in `frontend/` and `backend/`. In practice you shouldn't be editing the SDK from this repo; consume the npm package instead.
- Phone numbers: frontend and backend both normalize to E.164 (`+1` prefix for 10-digit US numbers). Both `signalwire.ts:makeCall` and `utils/signalwire.py:format_phone_number` do this — keep them in sync if you change the rules.
