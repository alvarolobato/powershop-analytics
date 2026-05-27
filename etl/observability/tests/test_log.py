"""Tests for etl/observability/log.py.

Uses the OTel SDK's in-memory exporters when available, otherwise tests
the fallback stdout path.
"""

from __future__ import annotations

import pytest

from etl.observability.log import (
    _sanitize_attributes,
    _is_secret_key,
    _is_secret_value,
    get_logger,
)


# ---------------------------------------------------------------------------
# Unit tests for secret detection helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key",
    [
        "password",
        "api_key",
        "secret",
        "token",
        "authorization",
        "API_KEY",
        "my_password_field",
    ],
)
def test_is_secret_key_true(key):
    assert _is_secret_key(key) is True


@pytest.mark.parametrize("key", ["table", "rows", "duration_ms", "status", "error"])
def test_is_secret_key_false(key):
    assert _is_secret_key(key) is False


@pytest.mark.parametrize(
    "value",
    ["my-secret-value", "bearer token here", "password=foo"],
)
def test_is_secret_value_true(value):
    assert _is_secret_value(value) is True


def test_is_secret_value_false():
    assert _is_secret_value("articulos") is False
    assert _is_secret_value(123) is False


# ---------------------------------------------------------------------------
# Sanitize attributes
# ---------------------------------------------------------------------------


def test_sanitize_removes_secret_keys():
    clean, denied = _sanitize_attributes(
        {"table": "ventas", "api_key": "sk-123", "rows": 10}
    )
    assert "api_key" not in clean
    assert clean == {"table": "ventas", "rows": 10}
    assert "api_key" in denied


def test_sanitize_removes_secret_values():
    clean, denied = _sanitize_attributes({"info": "password=hunter2"})
    assert "info" not in clean
    assert "info" in denied


def test_sanitize_passes_clean_attrs():
    clean, denied = _sanitize_attributes({"table": "articulos", "rows": 500})
    assert clean == {"table": "articulos", "rows": 500}
    assert denied == []


# ---------------------------------------------------------------------------
# Logger output
# ---------------------------------------------------------------------------


def test_logger_info_produces_stdout_line(capsys):
    log = get_logger("test.module")
    log.info("hello world", table="articulos", rows=10)
    captured = capsys.readouterr()
    assert "hello world" in captured.out
    assert "table='articulos'" in captured.out
    assert "rows=10" in captured.out


def test_logger_error_produces_stderr_line(capsys):
    log = get_logger("test.module")
    log.error("something broke", error="oops")
    captured = capsys.readouterr()
    assert "something broke" in captured.err
    assert "error='oops'" in captured.err


def test_logger_drops_secret_key(capsys):
    log = get_logger("test.module")
    log.info("test", api_key="sk-should-be-dropped")
    captured = capsys.readouterr()
    # The api_key value must NOT appear anywhere in output
    assert "sk-should-be-dropped" not in captured.out
    assert "sk-should-be-dropped" not in captured.err


def test_logger_drops_secret_value(capsys):
    log = get_logger("test.module")
    log.info("test", credentials="my-secret-string")
    captured = capsys.readouterr()
    assert "my-secret-string" not in captured.out
    assert "my-secret-string" not in captured.err


def test_logger_warning_emits_when_secret_dropped(capsys):
    log = get_logger("test.drop_warn")
    log.info("test", password="hunter2")
    captured = capsys.readouterr()
    # Should see a warning about dropped attributes
    assert "Dropped" in captured.out or "Dropped" in captured.err


def test_logger_includes_level_and_name(capsys):
    log = get_logger("myetl.sync")
    log.info("sync done")
    captured = capsys.readouterr()
    assert "level=INFO" in captured.out
    assert "logger=myetl.sync" in captured.out


def test_logger_exception_includes_traceback(capsys):
    log = get_logger("test.exc")
    try:
        raise ValueError("deliberate test error")
    except ValueError:
        log.exception("caught an error")
    captured = capsys.readouterr()
    assert "caught an error" in captured.err
    assert "ValueError" in captured.err
