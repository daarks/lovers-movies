"""Chamadas TMDB com cache + retry + métricas opcionais."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Callable

import requests

from services.cache_stampede import get_or_compute
from services.http_resilience import request_with_retry
from services.structured_logging import IntegrationTimer


def stable_cache_key(prefix: str, url: str, params: dict[str, Any]) -> str:
    items = sorted((str(k), json.dumps(v, sort_keys=True, default=str)) for k, v in params.items())
    raw = url + "?" + "&".join(f"{k}={v}" for k, v in items)
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:48]
    return f"{prefix}:{h}"


def tmdb_get_json_cached(
    *,
    cache_get: Callable[[str], Any],
    cache_set: Callable[[str, Any, int], None],
    session: requests.Session,
    token: str,
    url: str,
    params: dict[str, Any],
    headers: dict[str, str],
    ttl: int,
    timeout: float = 18.0,
    metrics: dict[str, int] | None = None,
    log_op: str = "GET",
) -> dict[str, Any] | list[Any] | None:
    """
    GET JSON TMDB com cache read-through e proteção a stampede.
    Não cacheia respostas nulas (erro de rede).
    """
    key = stable_cache_key("tmdb", url, {**params, "_lang": params.get("language", "")})

    def compute() -> dict[str, Any] | list[Any] | None:
        timer = IntegrationTimer("tmdb", log_op)
        try:
            r = request_with_retry(
                session,
                "GET",
                url,
                params=params,
                headers=headers,
                timeout=timeout,
                max_attempts=4,
            )
            r.raise_for_status()
            timer.done(status="ok", http_status=r.status_code)
            if metrics is not None:
                metrics["tmdb_miss"] = metrics.get("tmdb_miss", 0) + 1
            return r.json()
        except requests.RequestException as e:
            timer.done(status="error", error=type(e).__name__)
            return None

    def _get(k: str) -> Any:
        v = cache_get(k)
        if v is not None:
            if metrics is not None:
                metrics["tmdb_hit"] = metrics.get("tmdb_hit", 0) + 1
        return v

    def _set(k: str, val: Any, t: int) -> None:
        if val is not None:
            cache_set(k, val, t)

    # get_or_compute sempre seta; evitamos cachear None sobrescrevendo _set acima
    def _set_only_ok(k: str, val: Any, t: int) -> None:
        _set(k, val, t)

    return get_or_compute(_get, _set_only_ok, key, ttl, compute)
