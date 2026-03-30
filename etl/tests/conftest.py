"""Pytest fixtures for ETL tests."""
import os

import pytest

from etl.config import Config


def _postgres_available() -> bool:
    dsn = os.environ.get("POSTGRES_DSN")
    return bool(dsn and dsn.strip())


@pytest.fixture
def pg_conn():
    """Yield a psycopg2 connection; skip the test if POSTGRES_DSN is not set."""
    if not _postgres_available():
        pytest.skip("POSTGRES_DSN not set — skipping PostgreSQL tests")

    from etl.db import postgres

    config = Config()
    conn = postgres.get_connection(config)
    yield conn
    conn.close()
