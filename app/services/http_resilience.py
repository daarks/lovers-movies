"""HTTP com retry exponencial + jitter (TMDB e APIs públicas)."""
from __future__ import annotations

import logging
import random
import time
from typing import Any

import requests
from requests import Response

_log = logging.getLogger("movies_app.http")


def _should_retry(resp: Response | None, exc: BaseException | None) -> bool:
    if exc is not None:
        if isinstance(exc, requests.Timeout):
            return True
        if isinstance(exc, requests.ConnectionError):
            return True
        if isinstance(exc, requests.RequestException):
            return True
        return False
    if resp is None:
        return False
    if resp.status_code == 429:
        return True
    if 500 <= resp.status_code <= 599:
        return True
    return False


def request_with_retry(
    session: requests.Session,
    method: str,
    url: str,
    *,
    max_attempts: int = 4,
    base_delay: float = 0.35,
    timeout: float | tuple[float, float] = 20.0,
    **kwargs: Any,
) -> Response:
    """
    Executa request com até `max_attempts` tentativas.
    Respeita Retry-After (segundos) em 429 quando presente.
    """
    last_exc: BaseException | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            resp = session.request(method, url, timeout=timeout, **kwargs)
            if not _should_retry(resp, None):
                return resp
            if attempt == max_attempts:
                return resp
            retry_after = resp.headers.get("Retry-After")
            if retry_after:
                try:
                    wait = float(retry_after)
                except ValueError:
                    wait = base_delay * (2 ** (attempt - 1))
            else:
                wait = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 0.25)
            _log.debug(
                "HTTP retry %s/%s status=%s wait=%.2fs url=%s",
                attempt,
                max_attempts,
                resp.status_code,
                wait,
                url[:120],
            )
            time.sleep(wait)
        except requests.RequestException as e:
            last_exc = e
            if attempt == max_attempts:
                raise
            wait = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 0.25)
            _log.debug(
                "HTTP retry %s/%s exc=%s wait=%.2fs url=%s",
                attempt,
                max_attempts,
                type(e).__name__,
                wait,
                url[:120],
            )
            time.sleep(wait)
    if last_exc:
        raise last_exc
    raise RuntimeError("request_with_retry: estado inesperado")
