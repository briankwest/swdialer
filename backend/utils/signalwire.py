import os
import requests
from typing import Dict, Optional
import logging
from datetime import datetime, timedelta
import base64

logger = logging.getLogger(__name__)


class SignalWireClient:
    def __init__(self):
        self.space_name = os.getenv('SPACE_NAME')
        self.project_id = os.getenv('PROJECT_ID')
        self.auth_token = os.getenv('AUTH_TOKEN')

        if not all([self.space_name, self.project_id, self.auth_token]):
            raise ValueError("Missing required SignalWire configuration in environment variables")

        # SPACE_NAME in .env already contains the FQDN (e.g., spacename.signalwire.com or puc.swire.io)
        # Use it directly without modification
        self.api_base = f"https://{self.space_name}/api/fabric"
        self.auth = (self.project_id, self.auth_token)

    def create_subscriber_token(self, subscriber_id: str = None, reference: str = "swdialer", expires_in: int = 3600) -> Dict:
        """
        Create a subscriber token for Fabric access

        Args:
            subscriber_id: Optional subscriber identifier
            reference: Reference identifier for the token (required by SignalWire)
            expires_in: Token expiry time in seconds (default 1 hour)

        Returns:
            Dict containing token and expiry information
        """
        try:
            # SignalWire Fabric subscriber token endpoint
            url = f"{self.api_base}/subscribers/tokens"

            # Calculate expiry time
            expires_at = datetime.utcnow() + timedelta(seconds=expires_in)

            # Prepare the request payload
            payload = {
                "reference": reference,  # Required field for Fabric tokens
                "expires_at": expires_at.isoformat() + "Z",
                "audio": {
                    "send": True,
                    "receive": True
                },
                "video": {
                    "send": True,
                    "receive": True
                }
            }

            if subscriber_id:
                payload["subscriber_id"] = subscriber_id

            logger.info(f"Creating subscriber token with expiry: {expires_at}")

            # Make the API request
            response = requests.post(
                url,
                json=payload,
                auth=self.auth,
                headers={"Content-Type": "application/json"}
            )

            response.raise_for_status()
            data = response.json()

            # Format the response
            return {
                "token": data.get("token"),
                "expires_at": data.get("expires_at"),
                "expires_in": expires_in,
                "subscriber_id": data.get("subscriber_id"),
                "project_id": self.project_id,
                "space_name": self.space_name  # Already contains FQDN from .env
            }

        except requests.exceptions.RequestException as e:
            logger.error(f"Error creating subscriber token: {str(e)}")
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            raise Exception(f"Failed to create subscriber token: {str(e)}")

    def refresh_token(self, old_token: str = None, reference: str = "swdialer") -> Dict:
        """
        Refresh an existing subscriber token

        Args:
            old_token: The existing token (optional, for validation)
            reference: Reference identifier for the token

        Returns:
            Dict containing new token and expiry information
        """
        # For now, we'll just create a new token
        # In production, you might want to validate the old token first
        return self.create_subscriber_token(reference=reference, expires_in=3600)

    def validate_phone_number(self, phone_number: str) -> bool:
        """
        Basic phone number validation

        Args:
            phone_number: Phone number to validate

        Returns:
            Boolean indicating if the number appears valid
        """
        # Remove common formatting characters
        cleaned = ''.join(filter(str.isdigit, phone_number))

        # Check for minimum length (7 digits for local, 10 for US, 11+ for international)
        if len(cleaned) < 7:
            return False

        # Check for maximum reasonable length
        if len(cleaned) > 15:
            return False

        return True

    def format_phone_number(self, phone_number: str) -> str:
        """
        Format phone number for SignalWire

        Args:
            phone_number: Input phone number

        Returns:
            Formatted phone number with country code
        """
        # Remove all non-digit characters
        cleaned = ''.join(filter(str.isdigit, phone_number))

        # Add US country code if not present and number is 10 digits
        if len(cleaned) == 10:
            cleaned = '1' + cleaned

        # Add + prefix if not present
        if not cleaned.startswith('+'):
            cleaned = '+' + cleaned

        return cleaned