"""Estado de SwipeItem por casal+tmdb é persistente; cada nova sessão (novo public_id) deve isolar votos."""
from __future__ import annotations

from datetime import datetime

from models import SwipeItem, db


def reset_swipe_items_for_new_session_deck(
    swipe_cid: int, deck: list[dict], session_public_id: str
) -> None:
    """Repor pending/none para todas as cartas presentes no deck da sessão (evita match fantasma)."""
    if not deck or not session_public_id:
        return
    keys: set[tuple[int, str]] = set()
    for c in deck:
        if not isinstance(c, dict):
            continue
        try:
            tid = int(c.get("tmdb_id", 0))
        except (TypeError, ValueError):
            continue
        mt = str(c.get("media_type") or "").strip().lower()
        if mt not in ("movie", "tv") or tid <= 0:
            continue
        keys.add((tid, mt))
    if not keys:
        return
    for tid, mt in keys:
        row = SwipeItem.query.filter_by(
            couple_id=swipe_cid, tmdb_id=tid, media_type=mt
        ).first()
        if not row:
            continue
        row.state = "pending"
        row.vote_a = "none"
        row.vote_b = "none"
        row.last_session_public_id = session_public_id
        row.updated_at = datetime.utcnow()
