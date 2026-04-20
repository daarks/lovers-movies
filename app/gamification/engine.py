"""Motor de conquistas + XP + eventos (mesma transação que a rota)."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from gamification.bets import resolve_open_bets_for_watch
from gamification.feature_flags import gamification_v2_enabled, seasons_enabled
from gamification.snapshot import snapshot_from_json
from gamification.xp_levels import compute_xp_for_watch, level_and_progress

_log = logging.getLogger("movies_app.gamification")

_CATALOG: list[dict[str, Any]] | None = None


def load_achievements_catalog() -> list[dict[str, Any]]:
    """Catálogo público para páginas/API (mesmo cache que o motor)."""
    return _load_catalog()


def _load_catalog() -> list[dict[str, Any]]:
    global _CATALOG
    if _CATALOG is not None:
        return _CATALOG
    path = Path(__file__).resolve().parent / "achievements_catalog.yaml"
    if not path.is_file():
        _CATALOG = []
        return _CATALOG
    with open(path, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    _CATALOG = list(raw.get("achievements") or [])
    return _CATALOG


def _count_watched(db, WatchedItem, couple_id: int) -> int:
    return WatchedItem.query.count()


def _count_genre_watched(db, WatchedItem, genre_substr: str) -> int:
    g = f"%{genre_substr}%"
    return (
        WatchedItem.query.filter(WatchedItem.genres.isnot(None))
        .filter(WatchedItem.genres.like(g))
        .count()
    )


def _count_genre_in_period(
    db, WatchedItem, genre_substr: str, start: datetime, end: datetime
) -> int:
    g = f"%{genre_substr}%"
    return (
        WatchedItem.query.filter(WatchedItem.genres.isnot(None))
        .filter(WatchedItem.genres.like(g))
        .filter(WatchedItem.added_at >= start)
        .filter(WatchedItem.added_at <= end)
        .count()
    )


def _count_keyword_in_period(
    db, WatchedItem, keyword_id: int, start: datetime, end: datetime
) -> int:
    """Conta quantos itens assistidos na janela têm `keyword_id` no snapshot."""
    total = 0
    rows = (
        WatchedItem.query.filter(WatchedItem.added_at >= start)
        .filter(WatchedItem.added_at <= end)
        .all()
    )
    for row in rows:
        snap = snapshot_from_json(getattr(row, "tmdb_snapshot_json", None))
        if not snap:
            continue
        ids = snap.get("keyword_ids") or []
        try:
            if int(keyword_id) in {int(x) for x in ids}:
                total += 1
        except (TypeError, ValueError):
            continue
    return total


def _count_tmdb_ids_in_period(
    db,
    WatchedItem,
    tmdb_ids: list[int],
    media_type: str | None,
    start: datetime,
    end: datetime,
) -> int:
    if not tmdb_ids:
        return 0
    id_set = {int(x) for x in tmdb_ids}
    q = (
        WatchedItem.query.filter(WatchedItem.added_at >= start)
        .filter(WatchedItem.added_at <= end)
        .filter(WatchedItem.tmdb_id.in_(id_set))
    )
    if media_type in ("movie", "tv"):
        q = q.filter(WatchedItem.media_type == media_type)
    return q.count()


def _streak_in_period(db, WatchedItem, start: datetime, end: datetime) -> int:
    """Maior sequência de dias consecutivos com pelo menos 1 item na janela."""
    dates = []
    for row in (
        WatchedItem.query.filter(WatchedItem.added_at >= start)
        .filter(WatchedItem.added_at <= end)
        .all()
    ):
        if row.added_at:
            dates.append(row.added_at.date())
    if not dates:
        return 0
    ordered = sorted(set(dates))
    best = cur = 1
    for i in range(1, len(ordered)):
        if (ordered[i] - ordered[i - 1]).days == 1:
            cur += 1
            best = max(best, cur)
        else:
            cur = 1
    return best


def _count_countries(db, WatchedItem) -> set[str]:
    out: set[str] = set()
    for row in WatchedItem.query.all():
        snap = snapshot_from_json(getattr(row, "tmdb_snapshot_json", None))
        if not snap:
            continue
        for c in snap.get("production_countries") or []:
            iso = (c.get("iso") or "").upper()
            if iso:
                out.add(iso)
    return out


def _streak_days(db, WatchedItem) -> int:
    dates = []
    for row in WatchedItem.query.all():
        if row.added_at:
            dates.append(row.added_at.date())
    if not dates:
        return 0
    dates = sorted(set(dates), reverse=True)
    streak = 1
    for i in range(1, len(dates)):
        if (dates[i - 1] - dates[i]).days == 1:
            streak += 1
        else:
            break
    return streak


def _swipe_matches_count(db, SwipeItem, couple_id: int) -> int:
    return SwipeItem.query.filter_by(couple_id=couple_id, state="matched").count()


def _grant_xp(
    db,
    XpLedgerEntry,
    CoupleXpState,
    couple_id: int,
    amount: int,
    reason: str,
    ref: str | None,
) -> None:
    if amount <= 0:
        return
    db.session.add(
        XpLedgerEntry(
            couple_id=couple_id,
            amount=amount,
            reason=reason[:128],
            ref=ref[:128] if ref else None,
            created_at=datetime.utcnow(),
        )
    )
    st = CoupleXpState.query.filter_by(couple_id=couple_id).first()
    if not st:
        st = CoupleXpState(couple_id=couple_id, total_xp=0, level=1)
        db.session.add(st)
        db.session.flush()
    st.total_xp = int(st.total_xp or 0) + amount
    lv, _, _, _ = level_and_progress(st.total_xp)
    st.level = lv
    st.updated_at = datetime.utcnow()


def _upsert_achievement(
    db,
    AchievementProgress,
    couple_id: int,
    ach_id: str,
    target: int,
    current: int,
    icon: str,
) -> str | None:
    """Retorna achievement_id se desbloqueou agora."""
    row = AchievementProgress.query.filter_by(
        couple_id=couple_id, achievement_id=ach_id
    ).first()
    now = datetime.utcnow()
    if not row:
        row = AchievementProgress(
            couple_id=couple_id,
            achievement_id=ach_id,
            progress=min(current, target),
            target=target,
            unlocked_at=now if current >= target else None,
            meta_json=json.dumps({"icon": icon}, ensure_ascii=False),
        )
        db.session.add(row)
        return ach_id if current >= target else None
    row.progress = min(current, target)
    row.target = target
    if row.unlocked_at is None and current >= target:
        row.unlocked_at = now
        return ach_id
    return None


def _eval_rule(
    rule: dict[str, Any],
    ctx: dict[str, Any],
) -> tuple[int, int]:
    """Retorna (current, target)."""
    t = rule.get("type")
    tgt = int(rule.get("target", 1))
    if t == "count_watched":
        return int(ctx["watched_count"]), tgt
    if t == "count_genre":
        return int(ctx["genre_counts"].get(rule.get("genre", ""), 0)), tgt
    if t == "countries_unlocked":
        return len(ctx["countries"]), tgt
    if t == "streak_days":
        return int(ctx["streak"]), tgt
    if t == "swipe_matches":
        return int(ctx["swipe_matches"]), tgt
    if t == "seasonal_month_genre":
        month = datetime.utcnow().month
        want_m = int(rule.get("month", 10))
        if month != want_m:
            return 0, tgt
        g = rule.get("genre_substr", "Terror")
        return int(ctx["genre_counts"].get(g, 0)), tgt
    if t == "consensus_ratings":
        return 1 if ctx.get("consensus") else 0, 1
    if t == "count_genre_period":
        # Conta só dentro da janela da temporada ativa (matching por theme_key).
        theme = rule.get("theme_key")
        if theme and ctx.get("season_theme_key") != theme:
            return 0, tgt
        genre = rule.get("genre", "")
        return int(ctx.get("season_genre_counts", {}).get(genre, 0)), tgt
    if t == "count_keyword_period":
        theme = rule.get("theme_key")
        if theme and ctx.get("season_theme_key") != theme:
            return 0, tgt
        kw = rule.get("keyword_id")
        if kw is None:
            return 0, tgt
        return int(ctx.get("season_keyword_counts", {}).get(int(kw), 0)), tgt
    if t == "count_tmdb_ids_period":
        theme = rule.get("theme_key")
        if theme and ctx.get("season_theme_key") != theme:
            return 0, tgt
        list_id = rule.get("list_id")
        return int(ctx.get("season_list_counts", {}).get(list_id, 0)), tgt
    if t == "streak_days_period":
        theme = rule.get("theme_key")
        if theme and ctx.get("season_theme_key") != theme:
            return 0, tgt
        return int(ctx.get("season_streak", 0)), tgt
    return 0, tgt


def on_watched_saved(
    db,
    couple_id: int,
    watched_item,
    profile_ratings: list[tuple[int, float, str | None]],
) -> dict[str, Any]:
    """
    Chamado após gravar WatchedItem + WatchProfileRating na mesma sessão.
    Retorna resumo para UI (xp, unlocks).
    """
    out: dict[str, Any] = {"xp_gained": 0, "unlocks": [], "level": None}
    if not gamification_v2_enabled():
        return out

    from models import (  # noqa: PLC0415
        AchievementProgress,
        CoupleXpState,
        GamificationEvent,
        SwipeItem,
        WatchedItem,
        WatchBet,
        XpLedgerEntry,
    )

    db.session.add(
        GamificationEvent(
            couple_id=couple_id,
            event_type="media.watched",
            payload_json=json.dumps(
                {
                    "watched_item_id": watched_item.id,
                    "tmdb_id": watched_item.tmdb_id,
                    "media_type": watched_item.media_type,
                },
                default=str,
            ),
            created_at=datetime.utcnow(),
        )
    )

    review_len = len((watched_item.review or "").strip())
    ratings_vals = [r for _, r, _ in profile_ratings] if profile_ratings else []
    avg_r = (
        sum(ratings_vals) / len(ratings_vals)
        if ratings_vals
        else float(watched_item.rating)
    )
    streak = _streak_days(db, WatchedItem)
    xp, _bd = compute_xp_for_watch(
        review_len=review_len,
        rating_avg=avg_r,
        streak_days=streak,
    )
    _grant_xp(
        db,
        XpLedgerEntry,
        CoupleXpState,
        couple_id,
        xp,
        "watch",
        f"watched:{watched_item.id}",
    )
    out["xp_gained"] = xp

    season_ctx = _build_season_context(db, WatchedItem, watched_item, base_xp=xp)
    if season_ctx.get("bonus_xp") > 0:
        bonus_amount = int(season_ctx["bonus_xp"])
        _grant_xp(
            db,
            XpLedgerEntry,
            CoupleXpState,
            couple_id,
            bonus_amount,
            "watch_bonus_season",
            f"watched:{watched_item.id}:{season_ctx.get('theme_key') or 'season'}",
        )
        out["xp_gained"] += bonus_amount
        out["season_bonus"] = {
            "amount": bonus_amount,
            "theme_key": season_ctx.get("theme_key"),
            "matched_genres": season_ctx.get("matched_genres", []),
        }

    st = CoupleXpState.query.filter_by(couple_id=couple_id).first()
    if st:
        lv, into, need, title = level_and_progress(st.total_xp)
        out["level"] = {"level": lv, "into": into, "need": need, "title": title}

    watched_count = _count_watched(db, WatchedItem, couple_id)
    genre_counts = {
        "Drama": _count_genre_watched(db, WatchedItem, "Drama"),
        "Terror": _count_genre_watched(db, WatchedItem, "Terror")
        + _count_genre_watched(db, WatchedItem, "Horror"),
        "Comédia": _count_genre_watched(db, WatchedItem, "Comédia"),
        "Ação": _count_genre_watched(db, WatchedItem, "Ação"),
        "Horror": _count_genre_watched(db, WatchedItem, "Horror"),
    }
    countries = _count_countries(db, WatchedItem)
    consensus = False
    if len(ratings_vals) >= 2:
        consensus = max(ratings_vals) - min(ratings_vals) <= 1.0

    ctx = {
        "watched_count": watched_count,
        "genre_counts": genre_counts,
        "countries": countries,
        "streak": streak,
        "swipe_matches": _swipe_matches_count(db, SwipeItem, couple_id),
        "consensus": consensus,
        "season_theme_key": season_ctx.get("theme_key"),
        "season_genre_counts": season_ctx.get("genre_counts", {}),
        "season_keyword_counts": season_ctx.get("keyword_counts", {}),
        "season_list_counts": season_ctx.get("list_counts", {}),
        "season_streak": season_ctx.get("streak", 0),
    }

    for ach in _load_catalog():
        aid = ach.get("id")
        rule = ach.get("rule") or {}
        if not aid or not isinstance(rule, dict):
            continue
        if rule.get("type") == "seasonal_month_genre":
            if datetime.utcnow().month != int(rule.get("month", 10)):
                continue
        cur, tgt = _eval_rule(rule, ctx)
        icon = ach.get("icon") or "🏅"
        u = _upsert_achievement(
            db, AchievementProgress, couple_id, aid, tgt, cur, str(icon)
        )
        if u:
            out["unlocks"].append(
                {
                    "id": aid,
                    "title": ach.get("title", aid),
                    "icon": icon,
                    "rarity": ach.get("rarity", "common"),
                }
            )
            _grant_xp(
                db,
                XpLedgerEntry,
                CoupleXpState,
                couple_id,
                int(ach.get("xp_reward", 50)),
                f"achievement:{aid}",
                aid,
            )

    from gamification.feature_flags import bets_enabled

    if bets_enabled():
        resolve_open_bets_for_watch(db, WatchBet, couple_id, watched_item)

    if seasons_enabled():
        _season_add_points(db, couple_id, xp // 2)

    return out


def _build_season_context(db, WatchedItem, new_item, base_xp: int = 0) -> dict[str, Any]:
    """Calcula bônus de XP da temporada ativa e contadores para conquistas sazonais."""
    from gamification.season_themes import (
        bonus_genre_ids,
        bonus_genre_names,
        curated_tmdb_ids,
        get_theme,
        keyword_ids,
        xp_multiplier,
    )
    from gamification.seasons import current_season
    from models import GameSeason

    empty: dict[str, Any] = {
        "theme_key": None,
        "bonus_xp": 0,
        "matched_genres": [],
        "genre_counts": {},
        "keyword_counts": {},
        "list_counts": {},
        "streak": 0,
    }

    if not seasons_enabled():
        return empty

    season = current_season(db, GameSeason)
    if not season:
        return empty

    theme_key = season.theme_key
    theme = get_theme(theme_key)
    if not theme:
        return empty

    start = season.starts_at
    end = season.ends_at
    if not start or not end:
        return empty

    bonus_ids = bonus_genre_ids(theme_key)
    bonus_names = bonus_genre_names(theme_key)
    snap = snapshot_from_json(getattr(new_item, "tmdb_snapshot_json", None)) or {}
    item_genre_ids = {int(g) for g in (snap.get("genre_ids") or []) if g is not None}
    item_genre_names = {
        str(g).strip().lower() for g in (snap.get("genre_names") or []) if g
    }
    raw_genres_csv = (getattr(new_item, "genres", "") or "").lower()
    csv_tokens = {tok.strip() for tok in raw_genres_csv.split(",") if tok.strip()}

    matched_genres: list[str] = []
    for g in theme.get("bonus_genres", []):
        gid = int(g.get("tmdb_id", 0))
        gname = str(g.get("name", "")).strip()
        lname = gname.lower()
        if gid in item_genre_ids or lname in item_genre_names or any(
            lname in tok or tok in lname for tok in csv_tokens
        ):
            matched_genres.append(gname)

    bonus_xp = 0
    if matched_genres:
        mult = xp_multiplier(theme_key)
        if base_xp and base_xp > 0:
            bonus_xp = max(1, int(round((mult - 1.0) * base_xp)))
        else:
            avg = float(getattr(new_item, "rating", 0) or 0)
            bonus_xp = max(1, int(round((mult - 1.0) * (10 + int(avg * 2)))))

    # Contadores na janela da temporada (usados nas conquistas sazonais)
    genre_counts: dict[str, int] = {}
    for g in theme.get("bonus_genres", []):
        nm = str(g.get("name") or "")
        if nm:
            genre_counts[nm] = _count_genre_in_period(
                db, WatchedItem, nm, start, end
            )

    keyword_counts: dict[int, int] = {}
    for kid in keyword_ids(theme_key):
        keyword_counts[int(kid)] = _count_keyword_in_period(
            db, WatchedItem, int(kid), start, end
        )

    list_counts: dict[str, int] = {}
    for lst in theme.get("curated_lists", []):
        list_id = lst.get("id")
        if not list_id:
            continue
        ids = [int(i["tmdb_id"]) for i in lst.get("items", []) if i.get("tmdb_id")]
        list_counts[list_id] = _count_tmdb_ids_in_period(
            db, WatchedItem, ids, None, start, end
        )

    # Backwards: também indexar por list_id expressivo
    for list_id in list(list_counts.keys()):
        list_counts.setdefault(list_id, 0)

    streak = _streak_in_period(db, WatchedItem, start, end)

    _ = bonus_ids, bonus_names  # future use

    return {
        "theme_key": theme_key,
        "bonus_xp": int(bonus_xp or 0),
        "matched_genres": matched_genres,
        "genre_counts": genre_counts,
        "keyword_counts": keyword_counts,
        "list_counts": list_counts,
        "streak": streak,
    }


def _season_add_points(db, couple_id: int, points: int) -> None:
    from gamification.seasons import current_season
    from models import GameSeason, Profile, SeasonProfileScore

    if points <= 0:
        return
    cs = current_season(db, GameSeason)
    if not cs:
        return
    for p in Profile.query.filter_by(couple_id=couple_id).all():
        row = SeasonProfileScore.query.filter_by(
            season_id=cs.id, profile_id=p.id
        ).first()
        if not row:
            row = SeasonProfileScore(season_id=cs.id, profile_id=p.id, points=0)
            db.session.add(row)
        row.points = int(row.points or 0) + points
        row.updated_at = datetime.utcnow()


