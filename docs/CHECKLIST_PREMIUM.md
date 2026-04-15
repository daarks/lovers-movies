# Checklist premium — entrega Fase 2

- [ ] `GAMIFICATION_V2=1` em staging/produção após validar TMDB token.
- [ ] Página `/perfil` carrega barra de XP e atualiza fragmento HTMX.
- [ ] Marcar filme: snapshot JSON gravado; duas notas por perfil; evento `media.watched` na tabela `gamification_events`.
- [ ] Swipe até `matched`: evento `swipe.matched` gravado.
- [ ] Remoção no histórico: evento `media.deleted` gravado.
- [ ] Apostas (`BETS_ENABLED`): criar aposta via perfil; ao assistir, status `resolved` e `won` coerente.
- [ ] Comparador: dois IDs válidos mostram elenco em comum.
- [ ] Mapa: países aparecem após snapshots preenchidos.
- [ ] `prefers-reduced-motion`: verificar ausência de animações longas.
- [ ] Lighthouse (interno): sem regressão brutal de LCP na home.
