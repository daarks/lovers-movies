"""Helpers de log estruturado (JSON em uma linha) para integrações externas."""
from __future__ import annotations

import json
import logging
import time
from typing import Any

_log = logging.getLogger("movies_app.integrations")


def log_integration_event(
    *,
    integration: str,
    operation: str,
    duration_ms: float | None = None,
    status: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "integration": integration,
        "operation": operation,
    }
    if duration_ms is not None:
        payload["duration_ms"] = round(duration_ms, 2)
    if status:
        payload["status"] = status
    if extra:
        payload.update(extra)
    _log.info("%s", json.dumps(payload, ensure_ascii=False, default=str))


class IntegrationTimer:
    def __init__(self, integration: str, operation: str):
        self.integration = integration
        self.operation = operation
        self._t0 = time.perf_counter()

    def done(self, status: str = "ok", **extra: Any) -> None:
        dt = (time.perf_counter() - self._t0) * 1000
        log_integration_event(
            integration=self.integration,
            operation=self.operation,
            duration_ms=dt,
            status=status,
            extra=extra or None,
        )
