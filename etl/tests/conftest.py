"""Pytest fixtures for ETL tests."""
import os

import pytest

from etl.config import Config


def _postgres_available() -> bool:
    """Return True if PostgreSQL appears to be configured in the environment.

    Tests are skipped only when no PostgreSQL configuration is present.
    Misconfigurations (e.g., invalid P4D_PORT) are allowed to surface as test
    failures so they are not silently swallowed by a broad except-ValueError.
    """
    # Prefer a single explicit DSN.
    if os.environ.get("POSTGRES_DSN", "").strip():
        return True

    # Fall back to split connection variables (matches .env.example pattern).
    user = os.environ.get("POSTGRES_USER", "")
    password = os.environ.get("POSTGRES_PASSWORD", "")
    db = os.environ.get("POSTGRES_DB", "")
    return bool(user and password and db)


@pytest.fixture
def pg_conn():
    """Yield a psycopg2 connection; skip the test if PostgreSQL config is invalid."""
    if not _postgres_available():
        pytest.skip("PostgreSQL configuration not available — skipping PostgreSQL tests")

    from etl.db import postgres

    config = Config()
    conn = postgres.get_connection(config)
    yield conn
    conn.close()
