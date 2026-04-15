"""Curva de níveis: Espectador -> Cineasta e além."""
from __future__ import annotations

LEVEL_TITLES = [
    "Espectador",
    "Cinéfilo",
    "Crítico em formação",
    "Curador",
    "Cineasta",
    "Lenda do streaming",
    "Mestre da maratona",
    "Oráculo do Oscar",
]


def xp_threshold_for_level(level: int) -> int:
    """XP total acumulado mínimo para atingir `level` (1-indexed)."""
    if level <= 1:
        return 0
    total = 0
    for lv in range(1, level):
        total += int(80 * (lv**1.28) + 40)
    return total


def level_and_progress(total_xp: int) -> tuple[int, int, int, str]:
    """
    Retorna (level, xp_into_level, xp_for_next_level, title).
    """
    total_xp = max(0, int(total_xp))
    level = 1
    while True:
        need_next = xp_threshold_for_level(level + 1)
        if total_xp < need_next:
            break
        level += 1
        if level > 900:
            break
    floor = xp_threshold_for_level(level)
    ceiling = xp_threshold_for_level(level + 1)
    into = total_xp - floor
    need = max(1, ceiling - floor)
    title = LEVEL_TITLES[min(level - 1, len(LEVEL_TITLES) - 1)]
    return level, into, need, title


def compute_xp_for_watch(
    *,
    base: int = 25,
    review_len: int,
    rating_avg: float,
    genre_is_new: bool = False,
    streak_days: int = 0,
) -> tuple[int, dict]:
    """Retorna (xp_total, breakdown dict)."""
    xp = base
    breakdown: dict = {"base": base}
    if review_len >= 120:
        bonus = 15
        xp += bonus
        breakdown["long_review"] = bonus
    elif review_len >= 40:
        bonus = 8
        xp += bonus
        breakdown["review"] = bonus
    r = round(float(rating_avg), 2)
    if r <= 1.01 or r >= 9.99:
        mult = 2
        xp *= mult
        breakdown["extreme_rating_multiplier"] = mult
    if genre_is_new:
        breakdown["new_genre"] = 10
        xp += 10
    if streak_days >= 3:
        sbonus = min(30, 5 * streak_days)
        breakdown["streak"] = sbonus
        xp += sbonus
    return int(xp), breakdown
