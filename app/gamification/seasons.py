"""Temporadas trimestrais: criação lazy e consulta da temporada ativa."""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta

from sqlalchemy import and_


def _quarter_dates(year: int, q: int) -> tuple[datetime, datetime]:
    start_month = {1: 1, 2: 4, 3: 7, 4: 10}[q]
    end_month = start_month + 2
    start = datetime(year, start_month, 1)
    last = monthrange(year, end_month)[1]
    end = datetime(year, end_month, last, 23, 59, 59)
    return start, end


def ensure_current_season(db, GameSeason) -> None:
    from .season_themes import SEASON_THEMES

    today = date.today()
    y, m = today.year, today.month
    q = (m - 1) // 3 + 1
    label = f"{y}-Q{q}"
    if GameSeason.query.filter_by(label=label).first():
        return
    quarter_to_theme = {
        1: "winter_awards",
        2: "summer_blockbusters",
        3: "autumn_thriller",
        4: "winter_magic",
    }
    key = quarter_to_theme[q]
    theme = SEASON_THEMES.get(key, {})
    title = theme.get("title") or key.replace("_", " ").title()
    trophy = theme.get("emoji") or "🏆"
    start, end = _quarter_dates(y, q)
    missions = [
        {"id": "m1", "title": "Assistir 5 filmes", "target": 5, "xp": 40},
        {"id": "m2", "title": "Explorar 2 países novos no mapa", "target": 2, "xp": 60},
        {"id": "m3", "title": "3 matches no swipe", "target": 3, "xp": 35},
    ]
    import json

    db.session.add(
        GameSeason(
            label=label,
            theme_key=key,
            title=title,
            trophy_icon=trophy,
            starts_at=start,
            ends_at=end,
            missions_json=json.dumps(missions, ensure_ascii=False),
            created_at=datetime.utcnow(),
        )
    )


def current_season(db, GameSeason):
    ensure_current_season(db, GameSeason)
    now = datetime.utcnow()
    return GameSeason.query.filter(
        and_(GameSeason.starts_at <= now, GameSeason.ends_at >= now)
    ).first()
