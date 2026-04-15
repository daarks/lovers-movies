"""Rótulos em pt-BR para UI (conquistas, XP, apostas)."""
from __future__ import annotations

from functools import lru_cache


@lru_cache(maxsize=1)
def _catalog_by_id() -> dict[str, dict]:
    from gamification.engine import load_achievements_catalog

    out: dict[str, dict] = {}
    for row in load_achievements_catalog():
        aid = row.get("id")
        if aid:
            out[str(aid)] = row
    return out


def achievement_title_pt(achievement_id: str | None) -> str:
    if not achievement_id:
        return ""
    row = _catalog_by_id().get(str(achievement_id))
    if row and row.get("title"):
        return str(row["title"])
    return str(achievement_id)


def achievement_icon_pt(achievement_id: str | None) -> str:
    if not achievement_id:
        return "🏅"
    row = _catalog_by_id().get(str(achievement_id))
    if row and row.get("icon"):
        return str(row["icon"])
    return "🏅"


def xp_reason_pt(reason: str | None) -> str:
    if not reason:
        return ""
    r = str(reason).strip()
    if r == "watch":
        return "Assistiu e registrou um título"
    if r.startswith("achievement:"):
        aid = r.split(":", 1)[1].strip()
        title = achievement_title_pt(aid)
        return f"Conquista: {title}"
    return r


def bet_status_pt(status: str | None) -> str:
    s = (status or "").strip().lower()
    if s == "open":
        return "Aberta"
    if s == "resolved":
        return "Resolvida"
    return status or ""


def bet_outcome_short_pt(won: bool | None, status: str | None) -> str:
    if (status or "").lower() != "resolved":
        return "Esperando resolução"
    if won is True:
        return "Palpite mais próximo"
    if won is False:
        return "Outro perfil acertou mais"
    return "Empate entre os palpites"
