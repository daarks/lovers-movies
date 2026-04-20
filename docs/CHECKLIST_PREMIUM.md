# Checklist premium — Rework completo (React + Liquid Glass 2026)

## Pré-deploy

- [ ] Rodar `cd frontend && npm install` (se houver deps novas).
- [ ] Rodar `cd frontend && npm run type-check` — sem erros TS.
- [ ] Rodar `cd frontend && npm run build` — manifest atualizado em `app/static/build/`.
- [ ] Confirmar `app/static/build/manifest.json` versionado no repo ou gerado na pipeline.
- [ ] Rodar `python3 -m pytest app/tests -q --deselect app/tests/test_gamification_phase2.py::test_mapa_page` — todos verdes.

## Infra

- [ ] `GAMIFICATION_V2=1`, `BETS_ENABLED=1` conforme flags.
- [ ] Service worker `/static/sw.js` atualizou de `v3-premium` para `v3-premium-2` — navegadores antigos vão refazer o precache.
- [ ] `systemctl restart movies-app.service` após build do frontend.
- [ ] Gunicorn com `deploy/start-gunicorn.sh` — garantir que serve `/static/build/assets/*`.

## Regressão funcional

- [ ] Home `/` carrega HomeApp (React) com trending, now_playing, upcoming, recent.
- [ ] Busca global (combobox) responde ao TMDB em <600ms.
- [ ] `/details/<tipo>/<id>` abre Ficha React com tabs (Sinopse, Elenco, Similares, Ficha, Trailers).
- [ ] `/assistir-depois` permite reordenar (framer-motion Reorder) e remover.
- [ ] `/historico` lista itens com filtros (gênero, mídia, nota) e infinite scroll (cursor).
- [ ] `/swipe` mostra deck, match e toast.
- [ ] `/apostas` cria/resolve apostas, detalhe carrega no React.
- [ ] `/mapa` acende países conforme snapshots.
- [ ] `/estatisticas` renderiza dashboard Recharts.
- [ ] `/perfil` mostra nível, XP, conquistas recentes, faixa de temporada.
- [ ] `/conquistas` lista todas conquistas com filtros Tipo/Estado.
- [ ] `/comparar` compara dois títulos TMDB por busca + coluna left/right.
- [ ] `/temporada` exibe hero temático, gêneros bônus, conquistas sazonais.
- [ ] Bottom-nav com indicator magnético (animação spring) nas rotas ativas.
- [ ] Drawer (menu) com transição suave (enhancer React sobre fallback HTML).
- [ ] Toasts globais (React DS) disparam em ações (marcar filme, salvar, erro).

## A11y / PWA

- [ ] `prefers-reduced-motion` desativa parallax/typewriter (testar via DevTools).
- [ ] Foco visível em botões/links (outline roxo 2px).
- [ ] `srcset` TMDB servindo posters responsivos (testar network em 3G).
- [ ] `content-visibility: auto` em listas longas (History, WatchLater).
- [ ] Offline (DevTools → offline): `/static/offline.html` aparece em navegação.
- [ ] Precache atualizado: `caches.keys()` mostra `nossa-lista-static-v3-premium-2`.

## Smoke manual (mobile)

- [ ] Safari iOS e Chrome Android abrem home sem erro JS.
- [ ] Drawer/bottom-nav operam com gestos nativos.
- [ ] Add to Home Screen → manifest aplica ícone e tema roxo.

## Deploy

```bash
cd frontend && npm ci && npm run build
cd ..
sudo systemctl restart movies-app.service
```

## Rollback rápido

- Se o build quebrar: `git revert <commit>` no frontend e `cd frontend && npm run build` de novo.
- Service worker pode ser zerado forçadamente via DevTools → Application → Unregister + clear site data.
