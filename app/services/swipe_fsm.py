"""Máquina de estados para swipe do casal (perfil a / b)."""
from __future__ import annotations

VALID_STATES = frozenset(
    {
        "pending",
        "liked_a",
        "liked_b",
        "rejected_a",
        "rejected_b",
        "matched",
        "rejected",
        "no_match",
    }
)


def transition_on_swipe(
    current: str,
    profile_slug: str,
    action: str,
) -> tuple[str | None, str | None]:
    """
    Retorna (novo_estado, erro).
    profile_slug: 'a' | 'b'
    action: 'like' | 'reject'
    """
    if current not in VALID_STATES:
        return None, "estado inválido"
    if profile_slug not in ("a", "b"):
        return None, "perfil inválido"
    if action not in ("like", "reject"):
        return None, "ação inválida"

    if current in ("matched", "rejected", "no_match"):
        return None, "cartão já finalizado"

    if current == "pending":
        if action == "like":
            return ("liked_a" if profile_slug == "a" else "liked_b"), None
        return ("rejected_a" if profile_slug == "a" else "rejected_b"), None

    if current == "liked_a":
        if profile_slug == "a":
            return None, "este perfil já avaliou este cartão"
        return ("matched" if action == "like" else "no_match"), None
    if current == "liked_b":
        if profile_slug == "b":
            return None, "este perfil já avaliou este cartão"
        return ("matched" if action == "like" else "no_match"), None
    if current == "rejected_a":
        if profile_slug == "a":
            return None, "este perfil já avaliou este cartão"
        return ("no_match" if action == "like" else "rejected"), None
    if current == "rejected_b":
        if profile_slug == "b":
            return None, "este perfil já avaliou este cartão"
        return ("no_match" if action == "like" else "rejected"), None
    return None, "transição impossível"
