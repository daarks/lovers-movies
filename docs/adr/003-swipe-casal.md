# ADR-003 — Swipe / match casal local

## Decisão

Dois perfis fixos (`Profile` slug `a`/`b`) ligados a um único `Couple`. Estado persistido em `SwipeItem.state` com máquina explícita (`transition_on_swipe`): `pending` → `liked_a` / `liked_b` → `matched` ou `rejected`.

## Trade-off

Sem login multi-tenant vs simplicidade e consistência forte no mesmo aparelho.

## Risco

Concorrência rara entre abas.

## Mitigação

Transação única por POST; constraint única `(couple_id, tmdb_id, media_type)`.
