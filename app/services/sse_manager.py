"""Gerenciador in-process de filas SSE por sessão de swipe e por casal."""

from __future__ import annotations

import queue
import threading
from typing import Any, Dict, List, Tuple

Listener = Tuple[queue.SimpleQueue, str]


class SSEManager:
    """Filas SimpleQueue por `session_public_id` (swipe) e por `couple_id` (eventos globais)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_session: Dict[str, List[Listener]] = {}
        self._by_couple: Dict[int, List[queue.SimpleQueue]] = {}

    def subscribe(self, session_id: str, profile: str) -> queue.SimpleQueue:
        q: queue.SimpleQueue = queue.SimpleQueue()
        prof = (profile or "a").strip().lower()
        if prof not in ("a", "b"):
            prof = "a"
        sid = (session_id or "").strip()
        if not sid:
            return q
        with self._lock:
            self._by_session.setdefault(sid, []).append((q, prof))
        return q

    def unsubscribe(self, session_id: str, q: queue.SimpleQueue) -> None:
        sid = (session_id or "").strip()
        if not sid:
            return
        with self._lock:
            lst = self._by_session.get(sid)
            if not lst:
                return
            lst = [x for x in lst if x[0] is not q]
            if lst:
                self._by_session[sid] = lst
            else:
                del self._by_session[sid]

    def broadcast(self, session_id: str, event: dict[str, Any]) -> None:
        sid = (session_id or "").strip()
        if not sid:
            return
        with self._lock:
            listeners = list(self._by_session.get(sid, []))
        for qq, _ in listeners:
            try:
                qq.put_nowait(event)
            except Exception:
                pass

    def broadcast_to_profile(self, session_id: str, profile: str, event: dict[str, Any]) -> None:
        sid = (session_id or "").strip()
        prof = (profile or "").strip().lower()
        if not sid or prof not in ("a", "b"):
            return
        with self._lock:
            listeners = list(self._by_session.get(sid, []))
        for qq, p in listeners:
            if p != prof:
                continue
            try:
                qq.put_nowait(event)
            except Exception:
                pass

    def subscribe_couple(self, couple_id: int) -> queue.SimpleQueue:
        q: queue.SimpleQueue = queue.SimpleQueue()
        cid = int(couple_id)
        if cid <= 0:
            return q
        with self._lock:
            self._by_couple.setdefault(cid, []).append(q)
        return q

    def unsubscribe_couple(self, couple_id: int, q: queue.SimpleQueue) -> None:
        cid = int(couple_id)
        if cid <= 0:
            return
        with self._lock:
            lst = self._by_couple.get(cid)
            if not lst:
                return
            lst = [x for x in lst if x is not q]
            if lst:
                self._by_couple[cid] = lst
            else:
                del self._by_couple[cid]

    def broadcast_couple(self, couple_id: int, event: dict[str, Any]) -> None:
        cid = int(couple_id)
        if cid <= 0:
            return
        with self._lock:
            listeners = list(self._by_couple.get(cid, []))
        for qq in listeners:
            try:
                qq.put_nowait(event)
            except Exception:
                pass


sse_manager = SSEManager()
