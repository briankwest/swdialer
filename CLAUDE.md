# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

iPhone-style web dialer using SignalWire's Fabric/WebRTC stack. Two services:

- `backend/` — Flask app on port **5001**. Mints SignalWire subscriber tokens and keeps an in-memory log of calls. It does **not** route media or signaling.
- `frontend/` — Vite + React + TypeScript on port **5173**. All WebRTC (signaling, media, DTMF) goes through the **published npm package** `@signalwire/js` (pinned to `4.0.0-rc.0` in `frontend/package.json`) directly from the browser. There is **no** local SDK alias — `vite.config.ts` resolves `@signalwire/js` from `node_modules` like any other dependency (and pre-bundles it plus `rxjs` via `optimizeDeps`). npm's `latest`/`rc`/`dev` tags have moved past `rc.0`; check `npm view @signalwire/js dist-tags` rather than assuming. Pin prereleases **exactly** (`npm install --save-exact`) — a caret range on a prerelease will float to other prereleases.
- `signalwire-js/` — a local, gitignored checkout (its own nested git repo) of the SignalWire Browser SDK monorepo at the same `4.0.0-rc.0` version. It is **not** wired into the dialer build (we consume the npm package); keep it for reference only — its `examples/` directory is the authoritative guide to the v4 API, and `packages/main/src/` is the SDK source if you need to read it. (It replaced the old `browser-sdk/` alias, which is gone.)

## Commands

A `venv` lives at the repo root (`/venv`). Always activate it before running Python: `source venv/bin/activate`. (A stale `backend/venv/` may also exist from an older README layout; use the root one. `requirements.txt` is pinned, so re-run `pip install -r backend/requirements.txt` after dependency bumps.)

```bash
# Backend (from repo root)
source venv/bin/activate
cd backend && python app.py            # dev server on :5001

# Frontend
cd frontend
npm install
npm run dev                            # Vite dev server on :5173 (proxies /api → :5001)
npm run build                          # tsc + vite build
npm run lint                           # eslint, --max-warnings 0 (any warning fails)
npx tsc --noEmit                       # typecheck only
```

There are no tests in this repo. `README.md` is the user-facing setup guide (env vars, API table, production steps) — keep it in sync when changing routes, env vars, or setup.

### Environment

`backend/.env` holds `SPACE_NAME` (the full host, e.g. `foo.signalwire.com`, used verbatim as `https://{SPACE_NAME}/api/fabric`), `PROJECT_ID`, `AUTH_TOKEN`, `PORT`, and `FRONTEND_URL`. `vite.config.ts` reads `FRONTEND_URL` from `backend/.env` to add its hostname to `allowedHosts` — useful for ngrok/tunneled dev.

**Token minting is fail-closed** (`backend/utils/security.py`). `/api/auth/token` and `/api/auth/refresh` return **503** if `DIALER_API_KEY` is unset in `backend/.env`, and **401** unless the request's `X-API-Key` header matches it. The frontend sends that header from `VITE_DIALER_API_KEY` in `frontend/.env`. Vite inlines it at build/dev-server start, so restart Vite after changing it. Both endpoints are also rate-limited to 10 req/min per IP (in-memory, honors `X-Forwarded-For`). If the UI says "Failed to connect to SignalWire", check these first. `/api/calls/*` and `/api/auth/validate` are not gated.

`POST /api/calls/incoming` rejects requests without a valid `X-SignalWire-Signature`/`X-Twilio-Signature` (HMAC-SHA1 over the public URL + sorted form params). Behind a tunnel, set `PUBLIC_URL` so the signed URL is reconstructed correctly; set `WEBHOOK_SIGNATURE_VALIDATION=false` only for local testing.

**Single-service mode.** `app.py` also serves a built SPA from `FRONTEND_DIST` (default `backend/frontend_dist/`) at `/` with an `index.html` fallback; with no build present `/` returns a JSON status blob. The code comments mention a Docker build, but no Dockerfile is in this repo.

## Architecture notes that aren't obvious from the file tree

**Token lifecycle.** Backend `/api/auth/token` and `/api/auth/refresh` both call `SignalWireClient.create_subscriber_token` — refresh just mints a fresh one. The frontend never stores tokens; instead `signalwire.ts` passes a `credentialProvider` with `authenticate`/`refresh` callbacks to `new SignalWire(...)`, and the SDK calls `refresh()` shortly before `expiry_at` (a 5s buffer in the SDK source, not a percentage of TTL). The SDK **only schedules refresh when `expiry_at` is a valid number**, and the token response gives the frontend nothing else to go on: the Fabric `POST /subscribers/tokens` API doesn't echo an expiry and the SAT is an encrypted JWE. So `create_subscriber_token` must request expiry via `expire_at` (Unix seconds — the API silently ignores other field names) and return that same value as `expires_at`. Don't add token caching on the frontend. The backend mints a **plain SAT** (no `sat:refresh` scope, no DPoP fingerprint), so the SDK relies on our developer `refresh()` callback rather than the Client Bound SAT path — that's expected. `signalwire.ts` subscribes to `client.warnings$` (added in `4.0.0-rc.0`): `credential_refresh_fallback`/`credential_no_refresh_handler` warnings there are the signal that token refresh isn't wired up correctly. (Optional future hardening: forward the `AuthenticateContext.fingerprint` from `authenticate(context)` to the backend with `scope: "sat:refresh"` to enable automatic Client Bound SAT refresh.)

**Call state is split across three places, deliberately:**
- `SignalWireService` (`frontend/src/services/signalwire.ts`) owns the SDK `Call` objects. It distinguishes `pendingCall` (ringing, not yet answered) from `currentCall` (active). Incoming calls that arrive while `currentCall` is set are auto-rejected.
- `useCallStore` (Zustand) holds UI state — `isInCall`, `isIncoming`, `callStatus`, mute/speaker flags.
- `useSignalWire` is the bridge: it wires SDK callbacks (`onIncomingCall`, `onCallEnded`, `onCallConnected`) into store updates.

**The SignalWire singleton must outlive React unmounts.** `useSignalWire`'s cleanup deliberately does **not** call `signalWireService.disconnect()` — only `App.tsx`'s `beforeunload` listener does. React StrictMode / re-renders would otherwise tear down the registration mid-call. If you need to "reset" the SDK, reload the page; don't try to re-initialize.

**Remote audio has a fallback path.** `remoteStream$` from the SDK isn't always reliable, so `setupRemoteAudioFallback` polls `(call as any).rtcPeerConnection` and attaches a `track` listener directly. Both paths feed `playRemoteStream`, which renders into a single `<audio id="sw-remote-audio">` element appended to `document.body`. Don't remove the fallback without verifying audio still works on both inbound and outbound calls.

**Call-ended detection is also redundant.** The SDK's `status$` can fail to emit `disconnected` on certain failures, so `monitorPeerConnection` also treats `iceConnectionState` of `closed`/`failed` and `connectionState` of `closed`/`failed` as call-ended. `endCall()` eagerly calls `handleCallEnded()` before awaiting `call.hangup()` for the same reason — don't reorder.

**Backend "call tracking" is cosmetic.** `active_calls`/`call_history` in `backend/api/calls.py` are module-level dicts/lists. They don't drive any SDK behavior; they exist for the optional `/api/calls/*` endpoints. The frontend posts to `/api/calls/dial` for logging — the actual dial happens via `client.dial()` in the browser. **But** `useSignalWire.makeCall` awaits that POST *before* dialing, so if the backend is down or rejects the number (<7 or >15 digits → 400), the call is never placed. Treat the backend call store as ephemeral debugging data, not source of truth.

**Codec preference.** `initialize()` sets `client.preferences.preferredAudioCodecs = ['PCMU', 'PCMA']` on the client, so every dial and answer offers G.711 ahead of Opus. Per-call overrides would bypass this.

## Conventions

- The `signalwire-js/` checkout has its own `CLAUDE.md` (e.g. `signalwire-js/packages/main/CLAUDE.md`) — those rules apply when editing files **inside** `signalwire-js/`, not to the dialer code in `frontend/` and `backend/`. In practice you shouldn't be editing the SDK from this repo; consume the npm package instead.
- Phone numbers: frontend and backend both normalize to E.164 (`+1` prefix for 10-digit US numbers). Both `signalwire.ts:makeCall` and `utils/signalwire.py:format_phone_number` do this — keep them in sync if you change the rules. They already differ slightly: the backend strips non-digit characters first, the frontend does not.
