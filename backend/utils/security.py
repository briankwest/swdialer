"""Security helpers: API-key gating, simple rate limiting, and
SignalWire/Twilio-compatible webhook signature validation.

Added to harden the demo before it is exposed publicly:
  - The token endpoints mint SignalWire subscriber tokens (which can place
    billable calls), so they must not be open to the internet.
  - The inbound webhook must reject spoofed POSTs.
"""
import os
import time
import hmac
import hashlib
import base64
import logging
from collections import defaultdict, deque

logger = logging.getLogger(__name__)

# ── Per-IP in-memory rate limiter (sliding window) ────────────────────────────
# Note: in-memory => per-worker, not global. Good enough as an abuse brake for
# a demo; pair with edge auth for real protection.
_buckets = defaultdict(deque)


def rate_limited(key: str, limit: int = 10, window_sec: int = 60) -> bool:
    """Return True if `key` has exceeded `limit` requests in `window_sec`."""
    now = time.time()
    dq = _buckets[key]
    while dq and dq[0] <= now - window_sec:
        dq.popleft()
    if len(dq) >= limit:
        return True
    dq.append(now)
    return False


def client_ip(request) -> str:
    """Best-effort client IP, honoring the proxy/tunnel forwarding header."""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.remote_addr or "unknown"


# ── API-key gate for the token endpoints ──────────────────────────────────────
def api_key_ok(request) -> bool:
    """Validate the X-API-Key header against DIALER_API_KEY.

    Fail-closed: if DIALER_API_KEY is not configured, NO request is allowed
    (returns False) so the token endpoint is never accidentally open.
    """
    expected = os.getenv("DIALER_API_KEY", "")
    if not expected:
        logger.error("DIALER_API_KEY is not set — refusing to mint tokens (fail-closed)")
        return False
    provided = request.headers.get("X-API-Key", "")
    return bool(provided) and hmac.compare_digest(provided, expected)


# ── SignalWire/Twilio-compatible webhook signature validation ─────────────────
def _public_url(request) -> str:
    """Reconstruct the public URL SignalWire signed against.

    Behind the Cloudflare tunnel the internal scheme/host differ from the public
    ones, and the signature is computed over the PUBLIC URL. Prefer an explicit
    PUBLIC_URL base, else rebuild from X-Forwarded-* headers.
    """
    base = os.getenv("PUBLIC_URL", "").rstrip("/")
    if base:
        return base + request.full_path.rstrip("?")
    proto = request.headers.get("X-Forwarded-Proto", request.scheme)
    host = request.headers.get("X-Forwarded-Host") or request.host
    return f"{proto}://{host}{request.full_path.rstrip('?')}"


def valid_webhook_signature(request, auth_token: str) -> bool:
    """Validate the inbound webhook signature (LaML/compatibility scheme):
    base64(HMAC-SHA1(auth_token, public_url + sorted(k+v for form params)))
    compared to X-Twilio-Signature / X-SignalWire-Signature.
    """
    if not auth_token:
        return False
    sig = request.headers.get("X-Twilio-Signature") or request.headers.get("X-SignalWire-Signature")
    if not sig:
        return False
    params = request.form.to_dict() if request.form else {}
    data = _public_url(request)
    for k in sorted(params.keys()):
        data += k + params[k]
    digest = hmac.new(auth_token.encode("utf-8"), data.encode("utf-8"), hashlib.sha1).digest()
    expected = base64.b64encode(digest).decode("utf-8")
    return hmac.compare_digest(expected, sig)
