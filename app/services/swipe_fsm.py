"""Máquina de estados para swipe do casal (perfil a / b)."""
from __future__ import annotations

VALID_STATES = frozenset({"pending", "liked_a", "liked_b", "matched", "rejected"})


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

    if current == "matched" or current == "rejected":
        return None, "cartão já finalizado"

    if action == "reject":
        return "rejected", None

    # like
    if current == "pending":
        return ("liked_a" if profile_slug == "a" else "liked_b"), None
    if current == "liked_a":
        if profile_slug == "a":
            return None, "já curtido por este perfil"
        return "matched", None
    if current == "liked_b":
        if profile_slug == "b":
            return None, "já curtido por este perfil"
        return "matched", None
    return None, "transição impossível"
