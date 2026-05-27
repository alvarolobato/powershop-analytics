"""OTel metrics registry for the ETL.

Registers counters and histograms used throughout the ETL pipeline.
All instruments are created lazily so import is side-effect-free when
the OTel SDK is not initialised (unit tests, CLI invocations without
OTLP configured).

Usage::

    from etl.observability.metrics import record_sync_complete, record_sync_error
    record_sync_complete("articulos", rows=1234, duration_ms=4500)
    record_sync_error("ventas")
"""

from __future__ import annotations

from typing import Any

try:
    from opentelemetry import metrics as _otel_metrics

    _OTEL_AVAILABLE = True
except ImportError:  # pragma: no cover
    _OTEL_AVAILABLE = False
    _otel_metrics = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Instrument cache — created once, reused
# ---------------------------------------------------------------------------

_meter: Any = None
_rows_synced_counter: Any = None
_sync_duration_histogram: Any = None
_connection_errors_counter: Any = None
_runs_total_counter: Any = None


def _get_meter() -> Any:
    global _meter
    if _meter is None and _OTEL_AVAILABLE:
        _meter = _otel_metrics.get_meter("powershop.etl", version="1.0.0")
    return _meter


def _rows_counter() -> Any:
    global _rows_synced_counter
    if _rows_synced_counter is None:
        m = _get_meter()
        if m:
            _rows_synced_counter = m.create_counter(
                "etl.rows_synced",
                unit="rows",
                description="Total rows synced per table",
            )
    return _rows_synced_counter


def _duration_histogram() -> Any:
    global _sync_duration_histogram
    if _sync_duration_histogram is None:
        m = _get_meter()
        if m:
            _sync_duration_histogram = m.create_histogram(
                "etl.sync_duration_ms",
                unit="ms",
                description="Duration of each table sync in milliseconds",
            )
    return _sync_duration_histogram


def _conn_errors_counter() -> Any:
    global _connection_errors_counter
    if _connection_errors_counter is None:
        m = _get_meter()
        if m:
            _connection_errors_counter = m.create_counter(
                "etl.connection_errors_total",
                unit="errors",
                description="Total 4D or Postgres connection errors",
            )
    return _connection_errors_counter


def _runs_counter() -> Any:
    global _runs_total_counter
    if _runs_total_counter is None:
        m = _get_meter()
        if m:
            _runs_total_counter = m.create_counter(
                "etl.runs_total",
                unit="runs",
                description="Total ETL runs by status",
            )
    return _runs_total_counter


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def record_sync_complete(table: str, *, rows: int, duration_ms: int) -> None:
    """Record a successful table sync."""
    attrs = {"table": table}
    c = _rows_counter()
    if c is not None:
        c.add(rows, attrs)
    h = _duration_histogram()
    if h is not None:
        h.record(duration_ms, attrs)


def record_sync_error(table: str, *, duration_ms: int = 0) -> None:
    """Record a failed table sync."""
    attrs = {"table": table}
    h = _duration_histogram()
    if h is not None:
        h.record(duration_ms, {**attrs, "status": "error"})


def record_connection_error(source: str) -> None:
    """Increment the connection-error counter for the given source (4d or postgres)."""
    c = _conn_errors_counter()
    if c is not None:
        c.add(1, {"source": source})


def record_run_complete(status: str) -> None:
    """Record the completion of a full ETL run with its final status."""
    c = _runs_counter()
    if c is not None:
        c.add(1, {"status": status})
