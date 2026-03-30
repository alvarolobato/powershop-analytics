"""ETL configuration — loaded from environment variables via python-dotenv."""
import os
from dataclasses import dataclass, field
from urllib.parse import quote_plus

from dotenv import load_dotenv

load_dotenv()


def _get_p4d_port() -> int:
    """Return the P4D_PORT env var as an integer.

    Falls back to 19812 if unset or empty.
    Raises a clear ValueError if the value is set but not a valid integer.
    """
    raw = os.environ.get("P4D_PORT")
    if not raw:
        return 19812
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(
            f"Invalid value for P4D_PORT environment variable: {raw!r}. "
            "It must be a valid integer TCP port number."
        ) from exc


def _get_postgres_dsn() -> str:
    """Return the PostgreSQL DSN.

    Precedence:
    1. POSTGRES_DSN — explicit full DSN (recommended for Docker deployments).
    2. Assembled from POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB + optional
       POSTGRES_HOST (default "localhost") / POSTGRES_PORT (default "5432").
       This matches the split variables documented in .env.example so new users
       do not need to manually construct a DSN string.

    Returns an empty string if neither form is set (validated in __post_init__).
    """
    dsn = (os.environ.get("POSTGRES_DSN") or "").strip()
    if dsn:
        return dsn

    user = os.environ.get("POSTGRES_USER", "")
    password = os.environ.get("POSTGRES_PASSWORD", "")
    db = os.environ.get("POSTGRES_DB", "")
    host = os.environ.get("POSTGRES_HOST", "localhost")
    port = os.environ.get("POSTGRES_PORT", "5432")

    if user and db:
        # URL-encode user/password to handle reserved characters (@, :, /, etc.).
        encoded_user = quote_plus(user)
        if password:
            encoded_password = quote_plus(password)
            return f"postgresql://{encoded_user}:{encoded_password}@{host}:{port}/{db}"
        return f"postgresql://{encoded_user}@{host}:{port}/{db}"

    return ""


@dataclass
class Config:
    p4d_host: str = field(default_factory=lambda: os.environ.get("P4D_HOST", ""))
    p4d_port: int = field(default_factory=_get_p4d_port)
    p4d_user: str = field(default_factory=lambda: os.environ.get("P4D_USER", ""))
    p4d_password: str = field(
        default_factory=lambda: os.environ.get("P4D_PASSWORD", "")
    )
    postgres_dsn: str = field(default_factory=_get_postgres_dsn)

    def __post_init__(self) -> None:
        self.postgres_dsn = self.postgres_dsn.strip()
        if not self.postgres_dsn:
            raise ValueError(
                "PostgreSQL DSN is required but could not be determined. "
                "Set POSTGRES_DSN to a full connection string (e.g. "
                "'postgresql://user:password@host:5432/dbname'), "
                "or set POSTGRES_USER + POSTGRES_PASSWORD + POSTGRES_DB "
                "(matching the variables in .env.example)."
            )
