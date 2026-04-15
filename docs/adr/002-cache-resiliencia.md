# ADR-002 — Cache e resiliência TMDB

## Decisão

`Flask-Caching` (SimpleCache ou FileSystemCache via `CACHE_TYPE` / `CACHE_DIR`) com chaves hash estáveis (`stable_cache_key`), TTL por tipo de endpoint, read-through com `get_or_compute` + lock anti-stampede. Retries HTTP com backoff + jitter (`request_with_retry`).

## Trade-off

Dados eventualmente consistentes vs menor latência e proteção a rate limit.

## Risco

Respostas stale ou cache miss storm em cold start.

## Mitigação

TTL moderados (ex.: 240–720s em discover); não cachear corpo `None` em falhas TMDB; métricas em `/metrics`.
