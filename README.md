# SignalWire iPhone Dialer

A web-based, iPhone-style dialer for making and receiving phone calls in the browser over WebRTC, built with React and the SignalWire Browser SDK (`@signalwire/js` v4).

## How it works

- **Frontend** (`frontend/`, Vite + React + TypeScript, port 5173): all signaling, media, and DTMF go directly from the browser to SignalWire through `@signalwire/js`.
- **Backend** (`backend/`, Flask, port 5001): mints short-lived SignalWire subscriber tokens and keeps an in-memory call log for debugging. It never handles call media or signaling.

In development, Vite proxies `/api` to the backend. In production the backend can serve the built frontend itself (see [Production deployment](#production-deployment)).

## Features

- iPhone-style dialer UI with dark theme
- Outbound calls to phone numbers (10-digit numbers are treated as US and get `+1`)
- Inbound calls with a full-screen incoming-call screen and ringtone
- In-call DTMF from the on-screen keypad or your keyboard
- Mute and a live call timer (the speaker button is currently visual only)
- Automatic token refresh shortly before the token expires
- Microphone permission prompt, connecting/connection-error screens, and an error boundary

## Prerequisites

- Python 3.10+
- Node.js 18+ and npm
- A SignalWire space: its host (e.g. `your-space.signalwire.com`), a Project ID, and an API token
- A browser with WebRTC support. Microphone access only works on a secure origin: `http://localhost` or HTTPS.

## Setup

### 1. Backend

From the repository root:

```bash
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
SPACE_NAME=your-space.signalwire.com   # the full space host, not just the name
PROJECT_ID=your-project-id
AUTH_TOKEN=your-api-token
DIALER_API_KEY=a-long-random-secret
PORT=5001
FRONTEND_URL=http://localhost:5173
```

Generate a value for `DIALER_API_KEY` with:

```bash
python3 -c "import secrets; print(secrets.token_hex(24))"
```

`DIALER_API_KEY` is **required**. Without it the token endpoints refuse every request (HTTP 503) and the dialer cannot connect.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `frontend/.env` and set `VITE_DIALER_API_KEY` to the **same value** as `DIALER_API_KEY`. Vite reads it when the dev server starts or the app is built, so restart `npm run dev` (or rebuild) after changing it.

> The key is embedded in the JavaScript bundle, so anyone who can load the page can read it. It stops casual abuse of the token endpoint, not a determined user. Put the app behind real authentication (for example an authenticating reverse proxy) before exposing it publicly.

### 3. Run

Terminal 1, from the repository root:

```bash
source venv/bin/activate
cd backend
python app.py                     # http://localhost:5001
```

Terminal 2:

```bash
cd frontend
npm run dev                       # http://localhost:5173
```

## Usage

1. Open `http://localhost:5173`.
2. Wait for "Connecting to SignalWire..." to finish, then grant microphone access.
3. Enter a phone number and press the green call button.
4. Incoming calls show a full-screen screen with answer/decline. A second incoming call during an active call is rejected automatically.

### Receiving calls

The backend mints every token for a single Fabric subscriber with the reference `swdialer` (fixed in `backend/api/auth.py`), so calls to that subscriber ring every open dialer. To reach it from the phone network, route a phone number to that subscriber in your SignalWire space (Fabric phone routes: `POST /api/fabric/resources/{id}/phone_routes`).

The `/api/calls/incoming` webhook is **not** needed to ring the dialer; it only adds entries to the backend's debug call log.

### Using a tunnel (ngrok, Cloudflare Tunnel)

Set `FRONTEND_URL` in `backend/.env` to the public HTTPS URL and restart both servers. The backend allows it for CORS, and Vite adds its hostname to the dev server's allowed hosts. Use the HTTPS URL, since browsers block the microphone on plain-HTTP origins other than localhost.

## Configuration reference

### `backend/.env`

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SPACE_NAME` | yes | — | Full space host, e.g. `your-space.signalwire.com` |
| `PROJECT_ID` | yes | — | SignalWire Project ID |
| `AUTH_TOKEN` | yes | — | SignalWire API token; also used to verify webhook signatures |
| `DIALER_API_KEY` | yes | — | Shared secret required in the `X-API-Key` header on `/api/auth/token` and `/api/auth/refresh` |
| `PORT` | no | `5001` | Port for `python app.py` (gunicorn uses `--bind` instead) |
| `FRONTEND_URL` | no | `http://localhost:5173` | Allowed CORS origin; its hostname is also added to Vite's allowed hosts |
| `FLASK_DEBUG` | no | `False` | Flask debug mode for `python app.py` |
| `SECRET_KEY` | no | random per start | Flask secret key |
| `PUBLIC_URL` | no | — | Public base URL used to verify webhook signatures behind a proxy or tunnel |
| `WEBHOOK_SIGNATURE_VALIDATION` | no | `true` | Set to `false` to skip signature checks on `/api/calls/incoming` (local testing only) |
| `FRONTEND_DIST` | no | `backend/frontend_dist` | Directory of the built frontend to serve at `/` |

### `frontend/.env`

| Variable | Required | Purpose |
|---|---|---|
| `VITE_DIALER_API_KEY` | yes | Must match `DIALER_API_KEY`; sent as `X-API-Key` on token requests |

## Backend API

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Serves the built frontend if one exists at `FRONTEND_DIST`; otherwise a JSON status |
| `GET` | `/health` | `200` when SignalWire credentials are configured, `503` otherwise |
| `POST` | `/api/auth/token` | Mint a 1-hour subscriber token. Requires `X-API-Key`; limited to 10 requests/minute per IP |
| `POST` | `/api/auth/refresh` | Mint a replacement token (same key and rate limit) |
| `POST` | `/api/auth/validate` | Placeholder; always reports the token as valid |
| `POST` | `/api/calls/dial` | Log an outbound call (`{"to": "+15551234567"}`). The frontend calls this before every dial, so a rejected number (fewer than 7 or more than 15 digits) blocks the call |
| `POST` | `/api/calls/incoming` | SignalWire webhook that logs an inbound call; requires a valid signature |
| `GET` | `/api/calls/status/<call_id>` | Look up a logged call |
| `POST` | `/api/calls/end/<call_id>` | Mark a logged call as ended |
| `GET` | `/api/calls/history` | Ended calls; optional `limit` (default 50) and `direction` (`inbound`/`outbound`) |
| `GET` | `/api/calls/active` | Calls not yet ended |

The call log lives in memory: it is per process and cleared on restart.

## Development

```bash
cd frontend
npm run dev        # dev server with /api proxy
npm run build      # type-check (tsc) and production build into frontend/dist
npm run lint       # ESLint; fails on any warning
npm run preview    # serve the production build locally
```

There is no automated test suite.

### Project structure

```
backend/
├── app.py                 # Flask app: blueprints, SPA serving, /health
├── api/
│   ├── auth.py            # /api/auth/* token endpoints (API-key gate + rate limit)
│   └── calls.py           # /api/calls/* in-memory call log and inbound webhook
├── utils/
│   ├── signalwire.py      # Fabric REST client: subscriber tokens, phone number formatting
│   └── security.py        # API-key check, rate limiter, webhook signature validation
├── requirements.txt
└── .env.example

frontend/
├── src/
│   ├── App.tsx            # Connection and microphone permission gating
│   ├── components/        # Dialer, DialPad, CallScreen, IncomingCall, ErrorBoundary
│   ├── hooks/
│   │   ├── useSignalWire.ts   # Bridges SDK callbacks into the call store
│   │   └── useCallStore.ts    # Zustand UI call state
│   ├── services/
│   │   ├── signalwire.ts  # SignalWire client wrapper: register, dial, answer, audio, refresh
│   │   ├── api.ts         # Backend client (sends X-API-Key)
│   │   └── tones.ts       # DTMF, ringtone, and disconnect tones
│   └── types/index.ts
├── vite.config.ts         # /api proxy and allowed hosts
└── .env.example
```

## Production deployment

The backend can serve the built frontend and the API from one origin:

```bash
# 1. Build the frontend. Set VITE_DIALER_API_KEY in frontend/.env first; it is baked into the bundle.
cd frontend
npm ci
npm run build

# 2. Put the build where the backend looks for it (or set FRONTEND_DIST to frontend/dist's absolute path).
rm -rf ../backend/frontend_dist
cp -R dist ../backend/frontend_dist

# 3. Run the backend with gunicorn.
cd ../backend
source ../venv/bin/activate
gunicorn --workers 1 --bind 0.0.0.0:5001 app:app
```

Then:

- Serve it over HTTPS (for example, terminate TLS at a reverse proxy); browsers require it for microphone access.
- Put real authentication in front of the app. `DIALER_API_KEY` alone does not protect a public deployment.
- The rate limiter and call log are in-memory per worker. With more than one worker, each worker keeps its own limits and log.
- If you use the `/api/calls/incoming` webhook behind a proxy, set `PUBLIC_URL` to the public base URL so signatures verify.

## Troubleshooting

### "Connection Error" / "Failed to connect to SignalWire"

Check the `/api/auth/token` response in the browser's network tab:

- **503 "Token service not configured"**: `DIALER_API_KEY` is missing from `backend/.env`. Add it and restart the backend.
- **401 "Unauthorized"**: `VITE_DIALER_API_KEY` is missing or doesn't match. Fix `frontend/.env`, then restart `npm run dev` or rebuild.
- **429 "Rate limit exceeded"**: more than 10 token requests in a minute from your IP (easy to hit by reloading repeatedly). Wait a minute.
- **500**: SignalWire credentials are wrong or unreachable. Check the backend logs; `GET /health` shows whether they are configured.

### Calls won't dial

- The backend must be running: the frontend logs each call to `/api/calls/dial` before dialing.
- Numbers must have 7 to 15 digits.

### Audio or microphone issues

1. Use `http://localhost` or HTTPS; browsers block the microphone elsewhere.
2. Make sure microphone permission is granted and no other app is holding the microphone.
3. Use headphones to avoid echo.

### Disconnected after about an hour

Tokens last one hour, and the SDK calls the frontend's refresh handler shortly before they expire. If sessions drop:

1. Look in the browser console for `SignalWire warning: credential_...` messages.
2. Check the backend logs for `POST /api/auth/refresh` requests and errors.

## Technology stack

### Frontend

- **React 18** with TypeScript
- **Vite** dev server and build tool
- **Tailwind CSS** for styling
- **Zustand** for state management
- **@signalwire/js** v4 Browser SDK for WebRTC calling
- **Axios** for backend requests
- **Lucide React** for icons

### Backend

- **Flask** with **Flask-CORS**
- **Requests** to call the SignalWire Fabric REST API
- **python-dotenv** for configuration
- **Gunicorn** for production

## License

MIT

## Support

For SignalWire-specific issues, see the [SignalWire documentation](https://developer.signalwire.com/). For application issues, check the browser console and the backend logs.
