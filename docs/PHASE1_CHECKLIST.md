# Checklist de validação manual — Fase 1

- [ ] `/healthz` retorna 200 JSON
- [ ] `/metrics` mostra contadores TMDB após navegar na home
- [ ] Busca na home: query curta usa `/search`; query longa ou 2+ palavras usa `/search/smart`
- [ ] Detalhes: painel “Você sabia?” carrega ou fallback elegante
- [ ] `/casal`: deck carrega; perfil A/B; like/reject; match quando ambos curtem
- [ ] “O que assistir hoje?” sorteia e anti-repetição em dias seguidos
- [ ] Notificação: permissão negada → toast explicando fallback
- [ ] `/assistimos-hoje`: grid mensal; dia vazio mostra `:-(` ; adicionar/remover itens
- [ ] PWA: manifest 200; SW registrado; offline mostra página amigável em rotas cacheadas
- [ ] `GEMINI_HTTP_TIMEOUT_MS` inválido gera warning em log e fallback 90s

## Pausa

Aguardar aprovação explícita antes da **Fase 2**.
