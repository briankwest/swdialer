import os
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS
from dotenv import load_dotenv
import logging
from datetime import datetime

# Load environment variables
load_dotenv()

# Where the built React frontend lives (populated by the Docker build). When
# present, this single service serves the SPA at "/" and the API under "/api".
FRONTEND_DIST = os.getenv(
    "FRONTEND_DIST",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend_dist"),
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create Flask app. static_folder=None — we serve the SPA via an explicit
# catch-all below so it can fall back to index.html for client-side routes.
app = Flask(__name__, static_folder=None)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY') or os.urandom(32).hex()

# Configure CORS
frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:5173')
CORS(app, origins=[frontend_url], supports_credentials=True)

# Import blueprints
from api.auth import auth_bp
from api.calls import calls_bp

# Register blueprints
app.register_blueprint(auth_bp, url_prefix='/api/auth')
app.register_blueprint(calls_bp, url_prefix='/api/calls')


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    """Serve the built React SPA; fall back to index.html for client routes.

    API paths are handled by the blueprints (more specific rules win); guard
    anyway so a stray /api/* never gets the SPA shell.
    """
    if path.startswith('api/'):
        abort(404)
    candidate = os.path.join(FRONTEND_DIST, path)
    if path and os.path.isfile(candidate):
        return send_from_directory(FRONTEND_DIST, path)
    index_html = os.path.join(FRONTEND_DIST, 'index.html')
    if os.path.isfile(index_html):
        return send_from_directory(FRONTEND_DIST, 'index.html')
    # No build present (e.g. backend-only dev) — report status as JSON.
    return jsonify({
        "status": "online",
        "service": "SignalWire Dialer Backend",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    })


@app.route('/health')
def health_check():
    """Detailed health check"""
    try:
        # Check if environment variables are set
        config_status = all([
            os.getenv('SPACE_NAME'),
            os.getenv('PROJECT_ID'),
            os.getenv('AUTH_TOKEN')
        ])

        return jsonify({
            "status": "healthy" if config_status else "degraded",
            "checks": {
                "server": True,
                "config": config_status,
                "timestamp": datetime.utcnow().isoformat()
            }
        }), 200 if config_status else 503

    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return jsonify({
            "status": "unhealthy",
            "error": str(e)
        }), 503


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({
        "error": "Endpoint not found",
        "status": 404
    }), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    logger.error(f"Internal server error: {str(error)}")
    return jsonify({
        "error": "Internal server error",
        "status": 500
    }), 500


@app.before_request
def log_request_info():
    """Log incoming requests"""
    logger.debug(f"Headers: {dict(request.headers)}")
    logger.debug(f"Body: {request.get_data()}")


if __name__ == '__main__':
    # Check for required environment variables
    required_vars = ['SPACE_NAME', 'PROJECT_ID', 'AUTH_TOKEN']
    missing_vars = [var for var in required_vars if not os.getenv(var)]

    if missing_vars:
        logger.warning(f"Missing environment variables: {missing_vars}")
        logger.warning("Please copy .env.example to .env and configure your SignalWire credentials")

    # Run the Flask app
    port = int(os.getenv('PORT', 5001))  # Changed to 5001 to avoid conflict
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'

    logger.info(f"Starting SignalWire Dialer Backend on port {port}")
    app.run(host='0.0.0.0', port=port, debug=debug)