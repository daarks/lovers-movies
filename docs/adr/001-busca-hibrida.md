# ADR-001 — Busca híbrida (semântica + lexical + ranking)

## Decisão

Usar embeddings persistidos (`MediaEmbedding` + Gemini `embed_content`) combinados com score lexical sobre título/sinopse/gêneros/créditos e ranking final ponderado (`hybrid_rank_score`).

## Trade-off

Melhor relevância para consultas por vibe/tema vs custo de API de embedding e complexidade de indexação incremental.

## Risco

Cold start sem embeddings e custo variável do Gemini.

## Mitigação

Fallback lexical sempre ativo; cache TMDB nas buscas; embeddings gravados por título após primeira busca.
