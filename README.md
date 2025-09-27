# SignalWire iPhone Dialer

A web-based iPhone-style dialer application built with React and SignalWire SDK for making and receiving WebRTC calls.

## Features

- ✅ iPhone-style dialer UI with dark theme
- ✅ Outbound calling with DTMF tones
- ✅ Inbound call reception with full-screen UI
- ✅ Automatic token refresh without call interruption
- ✅ Call controls (mute, speaker, keypad)
- ✅ Real-time call duration display
- ✅ Microphone permission handling

## Prerequisites

- Node.js 18+ and npm
- Python 3.9+
- SignalWire account with Fabric resources
- Modern web browser with WebRTC support

## Setup

### 1. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
# venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file from example
cp .env.example .env
```

Edit `backend/.env` with your SignalWire credentials:
```env
SPACE_NAME=your-space.signalwire.com
PROJECT_ID=your-project-id
AUTH_TOKEN=your-auth-token
```

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install
```

### 3. Running the Application

Start the backend server:
```bash
cd backend
source venv/bin/activate  # If not already activated
python app.py
```

The backend will run on `http://localhost:5000`

In a new terminal, start the frontend:
```bash
cd frontend
npm run dev
```

The frontend will run on `http://localhost:5173`

## Usage

1. Open `http://localhost:5173` in your browser
2. Grant microphone permissions when prompted
3. Wait for SignalWire connection to establish
4. Enter a phone number and press the green call button to make a call
5. Incoming calls will show a full-screen notification

## Development

### Backend API Endpoints

- `POST /api/auth/token` - Generate subscriber token
- `POST /api/auth/refresh` - Refresh subscriber token
- `POST /api/calls/dial` - Log outbound call
- `POST /api/calls/incoming` - Handle incoming call webhook
- `GET /api/calls/status/{call_id}` - Get call status
- `POST /api/calls/end/{call_id}` - Mark call as ended
- `GET /api/calls/history` - Get call history

### Frontend Structure

```
src/
├── components/       # React components
│   ├── Dialer.tsx   # Main dialer interface
│   ├── DialPad.tsx  # Number pad with DTMF
│   ├── CallScreen.tsx # Active call UI
│   └── IncomingCall.tsx # Incoming call modal
├── hooks/           # Custom React hooks
│   ├── useSignalWire.ts # SignalWire SDK integration
│   └── useCallStore.ts  # Global call state
├── services/        # API and SignalWire clients
│   ├── api.ts       # Backend API client
│   └── signalwire.ts # SignalWire client wrapper
└── types/           # TypeScript definitions
```

## Troubleshooting

### Connection Issues

1. Verify SignalWire credentials in `.env`
2. Check that your SignalWire project has Fabric resources configured
3. Ensure both backend and frontend are running
4. Check browser console for errors

### Audio Issues

1. Ensure microphone permissions are granted
2. Check that no other application is using the microphone
3. Try using headphones to avoid echo

### Token Refresh Issues

The application automatically refreshes tokens at 80% of their lifetime. If you experience disconnections:

1. Check backend logs for token generation errors
2. Verify SignalWire API credentials
3. Ensure stable network connection

## Production Deployment

For production deployment:

1. Use environment variables for all sensitive configuration
2. Enable HTTPS for both frontend and backend
3. Configure proper CORS origins
4. Use a production WSGI server (e.g., Gunicorn) for Flask
5. Build the React app: `npm run build`
6. Serve static files with a web server (e.g., Nginx)

## License

MIT

## Support

For SignalWire-specific issues, consult the [SignalWire documentation](https://developer.signalwire.com/).

For application issues, check the logs in both backend and frontend consoles.