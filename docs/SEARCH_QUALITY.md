# Plano de qualidade — busca inteligente

## Consultas canônicas (revisão manual)

| ID | Consulta | Esperado |
|----|-----------|----------|
| Q1 | filme triste sobre perda | Dramas melancólicos no topo |
| Q2 | comédia leve para relaxar | Tom leve, alta lexical em “comédia” |
| Q3 | suspense denso psicológico | Thriller/mistério |
| Q4 | anime ação | Resultados com termos relacionados (TMDB) |
| Q5 | hide_horror=1 sem terror | Filtro sensível ativo |

## Avaliação

- Executar `/search/smart?q=...` e marcar top-5 como ✓ / ~ / ✗.
- Meta Fase 1: ≥ 80% ✓ nas consultas acima (amostra interna).

## Ajuste

- Calibrar pesos em `services/search_hybrid.py` (`hybrid_rank_score`).
