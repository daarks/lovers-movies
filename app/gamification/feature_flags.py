"""Feature flags (env) para rollout seguro."""
from __future__ import annotations

import os


def gamification_v2_enabled() -> bool:
    """Por omissão ativo em dev; desligue com GAMIFICATION_V2=0."""
    return os.environ.get("GAMIFICATION_V2", "1").lower() not in ("0", "false", "no")


def bets_enabled() -> bool:
    return gamification_v2_enabled() and os.environ.get(
        "BETS_ENABLED", "1"
    ).lower() not in ("0", "false", "no")


def seasons_enabled() -> bool:
    return gamification_v2_enabled() and os.environ.get(
        "SEASONS_ENABLED", "1"
    ).lower() not in ("0", "false", "no")
