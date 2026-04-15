"""Proteção simples contra stampede em cache read-through."""
from __future__ import annotations

import threading
from typing import Any, Callable, Hashable

_locks: dict[Hashable, threading.Lock] = {}
_meta_lock = threading.Lock()


def _lock_for(key: Hashable) -> threading.Lock:
    with _meta_lock:
        if key not in _locks:
            _locks[key] = threading.Lock()
        return _locks[key]


def get_or_compute(
    cache_get: Callable[[str], Any | None],
    cache_set: Callable[[str, Any, int], None],
    key: str,
    ttl: int,
    compute: Callable[[], Any],
) -> Any:
    """
    Lê do cache; em miss, serializa por chave e recalcula uma vez.
    `cache_set(key, value, ttl)` deve persistir o valor.
    """
    hit = cache_get(key)
    if hit is not None:
        return hit
    lk = _lock_for(key)
    with lk:
        hit2 = cache_get(key)
        if hit2 is not None:
            return hit2
        val = compute()
        cache_set(key, val, ttl)
        return val
