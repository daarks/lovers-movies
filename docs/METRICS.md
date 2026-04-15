# Métricas — baseline e coleta Fase 1

## Antes (referência conceitual)

- Latência p95 das chamadas TMDB na home e `/search` sem cache agregado.
- Timeouts ocasionais do Gemini em prompts longos.

## Depois (como medir)

1. **HTTP**: logs JSON em `movies_app.integrations` com `duration_ms` por operação TMDB.
2. **Cache**: `GET /metrics` expõe `tmdb_cache_hits` e `tmdb_cache_misses` (acumulado desde o boot do processo).
3. **Gemini**: mesmos logs na geração de texto; timeout efetivo via `GEMINI_HTTP_TIMEOUT_MS` + clamp documentado.

## Metas (Fase 1)

- Redução perceptível de repetição TMDB em navegação típica (hits > misses após warm-up).
- Menos erros transitórios em discover/suggestions graças a retry.
