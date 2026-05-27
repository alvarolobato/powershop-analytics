"""OTel-native structured logger for the ETL.

This is the only logging API that ETL code should use.  stdlib ``logging``
and ``print`` are banned in application code (enforced by ruff.toml and CI).

Usage::

    from etl.observability.log import get_logger
    log = get_logger(__name__)
    log.info("table sync complete", table="articulos", rows=123, duration_ms=4500)
    log.error("connection failed", error=str(exc))

All log records auto-attach the current span's trace_id / span_id.
Attribute values matching secret patterns are silently dropped with a warning.
"""

from __future__ import annotations

import re
import sys
from typing import Any

# ---------------------------------------------------------------------------
# Secret denylist — keys and values matching these patterns are stripped.
# ---------------------------------------------------------------------------

_SECRET_KEY_RE = re.compile(
    r"(?i)(password|api_key|secret|token|authorization|credential|passwd|auth)"
)
_SECRET_VAL_RE = re.compile(
    r"(?i)(password|api_key|secret|token|authorization|credential|passwd|auth)"
)


def _is_secret_key(key: str) -> bool:
    return bool(_SECRET_KEY_RE.search(key))


def _is_secret_value(value: Any) -> bool:
    if isinstance(value, str):
        return bool(_SECRET_VAL_RE.search(value))
    return False


def _sanitize_attributes(
    attributes: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """Return (clean_attrs, denied_keys).  Denied keys are stripped from output."""
    clean: dict[str, Any] = {}
    denied: list[str] = []
    for k, v in attributes.items():
        if _is_secret_key(k) or _is_secret_value(v):
            denied.append(k)
        else:
            clean[k] = v
    return clean, denied


# ---------------------------------------------------------------------------
# OTel imports — optional so unit tests don't require the SDK installed.
# ---------------------------------------------------------------------------

try:
    from opentelemetry import trace
    from opentelemetry._logs import get_logger as _otel_get_logger

    _OTEL_AVAILABLE = True
except ImportError:  # pragma: no cover
    _OTEL_AVAILABLE = False
    trace = None  # type: ignore[assignment]


def _get_trace_context() -> tuple[str | None, str | None]:
    """Return (trace_id_hex, span_id_hex) for the current active span, or (None, None)."""
    if not _OTEL_AVAILABLE or trace is None:
        return None, None
    try:
        span = trace.get_current_span()
        ctx = span.get_span_context()
        if ctx and ctx.is_valid:
            return format(ctx.trace_id, "032x"), format(ctx.span_id, "016x")
    except Exception:
        pass
    return None, None


class _Logger:
    """Structured logger backed by the OTel logs API."""

    def __init__(self, name: str) -> None:
        self._name = name
        self._otel_logger = _otel_get_logger(name) if _OTEL_AVAILABLE else None

    def _emit(self, level: str, message: str, *args: Any, **attributes: Any) -> None:
        # Support %-style format strings for easy migration from stdlib logging.
        if args:
            try:
                message = message % args
            except Exception:
                message = f"{message} {args}"
        clean, denied = _sanitize_attributes(attributes)
        if denied:
            # Emit a warning through the same path (recursion-safe because
            # the warning itself has no denied keys).
            self._emit(
                "WARNING",
                f"Dropped {len(denied)} attribute(s) matching secret pattern: {denied}",
            )

        trace_id, span_id = _get_trace_context()
        if trace_id:
            clean["trace_id"] = trace_id
        if span_id:
            clean["span_id"] = span_id

        if self._otel_logger is not None:
            try:
                from opentelemetry._logs import SeverityNumber
                from opentelemetry.sdk._logs import LogRecord
                import time

                severity_map = {
                    "DEBUG": SeverityNumber.DEBUG,
                    "INFO": SeverityNumber.INFO,
                    "WARNING": SeverityNumber.WARN,
                    "ERROR": SeverityNumber.ERROR,
                    "CRITICAL": SeverityNumber.FATAL,
                }
                sev = severity_map.get(level, SeverityNumber.INFO)
                self._otel_logger.emit(
                    LogRecord(
                        timestamp=int(time.time_ns()),
                        observed_timestamp=int(time.time_ns()),
                        trace_id=int(trace_id, 16) if trace_id else 0,
                        span_id=int(span_id, 16) if span_id else 0,
                        severity_number=sev,
                        severity_text=level,
                        body=message,
                        attributes=clean,
                    )
                )
            except Exception:
                pass  # never let logging failure crash the app

        # Always write a structured line to stdout so the collector's filelog
        # receiver captures it even if the OTLP exporter is unavailable.
        parts = [f"level={level}", f"logger={self._name}", f"msg={message!r}"]
        if trace_id:
            parts.append(f"trace_id={trace_id}")
        if span_id:
            parts.append(f"span_id={span_id}")
        for k, v in clean.items():
            if k not in ("trace_id", "span_id"):
                parts.append(f"{k}={v!r}")
        print(
            " ".join(parts),
            file=sys.stderr if level in ("ERROR", "CRITICAL") else sys.stdout,
            flush=True,
        )  # noqa: T201

    def debug(self, message: str, *args: Any, **attributes: Any) -> None:
        self._emit("DEBUG", message, *args, **attributes)

    def info(self, message: str, *args: Any, **attributes: Any) -> None:
        self._emit("INFO", message, *args, **attributes)

    def warning(self, message: str, *args: Any, **attributes: Any) -> None:
        self._emit("WARNING", message, *args, **attributes)

    # Alias
    warn = warning

    def error(self, message: str, *args: Any, **attributes: Any) -> None:
        self._emit("ERROR", message, *args, **attributes)

    def exception(self, message: str, *args: Any, **attributes: Any) -> None:
        """Log an error with the current exception info attached."""
        import traceback

        exc_text = traceback.format_exc()
        self._emit("ERROR", message, *args, exception=exc_text, **attributes)

    def critical(self, message: str, *args: Any, **attributes: Any) -> None:
        self._emit("CRITICAL", message, *args, **attributes)


_loggers: dict[str, _Logger] = {}


def get_logger(name: str) -> _Logger:
    """Return (or create) the named structured logger."""
    if name not in _loggers:
        _loggers[name] = _Logger(name)
    return _loggers[name]
