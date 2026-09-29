# -----------------------------------------------------------------------------
# Security helpers for password hashing, JWT handling, encryption, and authorization logic.
# -----------------------------------------------------------------------------

import base64
import hashlib
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt

from app.core.config import get_settings

password_hasher = PasswordHasher()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except VerificationError:
        return False


def get_encryption_key() -> bytes:
    """Derive a 32-byte URL-safe base64 key from settings.secret_key for Fernet encryption."""
    raw_key = hashlib.sha256(get_settings().secret_key.encode()).digest()
    return base64.urlsafe_b64encode(raw_key)


def encrypt_sensitive_data(plaintext: str) -> str:
    """Encrypts sensitive PII/data at rest using Fernet authenticated symmetric encryption."""
    if not plaintext:
        return ""
    f = Fernet(get_encryption_key())
    return f.encrypt(plaintext.encode()).decode()


def decrypt_sensitive_data(ciphertext: str) -> str:
    """Decrypts ciphertext encrypted with encrypt_sensitive_data."""
    if not ciphertext:
        return ""
    try:
        f = Fernet(get_encryption_key())
        return f.decrypt(ciphertext.encode()).decode()
    except (InvalidToken, Exception):
        return ciphertext


def mask_email(email: str) -> str:
    """Masks an email for GDPR/CCPA safe logging and display (e.g. j***e@example.com)."""
    if not email or "@" not in email:
        return email
    user, domain = email.split("@", 1)
    if len(user) <= 2:
        masked_user = user[0] + "*"
    else:
        masked_user = user[0] + "*" * (len(user) - 2) + user[-1]
    return f"{masked_user}@{domain}"


def create_token(subject: str, role: str, token_type: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": subject, "role": role, "type": token_type, "iat": now, "exp": now + expires_delta}
    if token_type == "refresh":
        payload["jti"] = str(uuid4())
    return jwt.encode(payload, get_settings().secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])
    except JWTError as error:
        raise ValueError("Invalid token") from error