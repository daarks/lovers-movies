"""Resolução de apostas contra nota real por perfil."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_


def resolve_open_bets_for_watch(db, WatchBet, couple_id: int, watched_item) -> int:
    """Resolve apostas abertas do casal para o mesmo tmdb/media. Retorna quantidade resolvida."""
    tid = watched_item.tmdb_id
    mt = watched_item.media_type
    bets = WatchBet.query.filter(
        and_(
            WatchBet.couple_id == couple_id,
            WatchBet.tmdb_id == tid,
            WatchBet.media_type == mt,
            WatchBet.status == "open",
        )
    ).all()
    if not bets:
        return 0

    joint = float(watched_item.rating)

    for b in bets:
        act = joint
        pred = float(b.predicted_rating)
        err = abs(pred - act)
        b.actual_rating = act
        b.error_abs = err
        b.watched_item_id = watched_item.id
        b.status = "resolved"
        b.resolved_at = datetime.utcnow()

    errs = [b for b in bets if b.error_abs is not None]
    if not errs:
        return len(bets)

    # Evita penalização por múltiplos palpites abertos do mesmo perfil:
    # o resultado final compara o melhor erro de cada perfil.
    best_by_profile: dict[int, float] = {}
    for b in errs:
        pid = int(getattr(b, "profile_id", 0) or 0)
        if pid <= 0:
            continue
        err = float(b.error_abs or 0.0)
        cur = best_by_profile.get(pid)
        if cur is None or err < cur:
            best_by_profile[pid] = err
    if not best_by_profile:
        return len(bets)

    global_best = min(best_by_profile.values())
    winner_profiles = {
        pid
        for pid, err in best_by_profile.items()
        if abs(err - global_best) < 1e-6
    }

    for b in bets:
        if b.error_abs is None:
            continue
        pid = int(getattr(b, "profile_id", 0) or 0)
        if len(winner_profiles) == 1 and pid in winner_profiles:
            b.won = True
        elif len(winner_profiles) > 1 and pid in winner_profiles:
            b.won = None
        else:
            b.won = False
    return len(bets)
