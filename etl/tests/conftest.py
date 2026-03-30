"""Pytest fixtures for ETL tests."""
import pytest

from etl.config import Config


def _postgres_available() -> bool:
    """Return True if a valid PostgreSQL configuration can be constructed.

    Reuses the same DSN resolution/validation logic as Config so tests run
    whenever a valid config exists — whether via POSTGRES_DSN or the split
    POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB variables.
    """
    try:
        Config()
    except ValueError:
        return False
    return True


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
