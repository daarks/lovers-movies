"""Presença por sessão de swipe e por casal (último visto, janela 45s)."""

from __future__ import annotations

import threading
from datetime import datetime, timedelta
from typing import Dict

ACTIVE = timedelta(seconds=45)

_lock = threading.Lock()
_session_seen: Dict[str, Dict[str, datetime]] = {}
_couple_seen: Dict[int, Dict[str, datetime]] = {}


def _norm_profile(profile: str) -> str | None:
    p = (profile or "").strip().lower()
    return p if p in ("a", "b") else None


def update_presence(session_id: str, profile: str) -> None:
    """Atualiza último visto na sessão de swipe (por `session_public_id`)."""
    prof = _norm_profile(profile)
    sid = (session_id or "").strip()
    if not prof or not sid:
        return
    now = datetime.utcnow()
    with _lock:
        d = _session_seen.setdefault(sid, {})
        d[prof] = now


def update_couple_presence(couple_id: int, profile: str) -> None:
    prof = _norm_profile(profile)
    cid = int(couple_id)
    if not prof or cid <= 0:
        return
    now = datetime.utcnow()
    with _lock:
        d = _couple_seen.setdefault(cid, {})
        d[prof] = now


def get_presence(session_id: str) -> dict[str, bool]:
    """Retorna ``{"a": bool, "b": bool}`` para a sessão de swipe."""
    sid = (session_id or "").strip()
    now = datetime.utcnow()
    with _lock:
        raw = dict(_session_seen.get(sid, {}))
    out: dict[str, bool] = {"a": False, "b": False}
    for k in ("a", "b"):
        ts = raw.get(k)
        if ts is not None and now - ts < ACTIVE:
            out[k] = True
    return out


def get_couple_presence(couple_id: int) -> dict[str, bool]:
    """Presença global do casal (ex.: header / polling)."""
    cid = int(couple_id)
    now = datetime.utcnow()
    with _lock:
        raw = dict(_couple_seen.get(cid, {}))
    out: dict[str, bool] = {"a": False, "b": False}
    for k in ("a", "b"):
        ts = raw.get(k)
        if ts is not None and now - ts < ACTIVE:
            out[k] = True
    return out
