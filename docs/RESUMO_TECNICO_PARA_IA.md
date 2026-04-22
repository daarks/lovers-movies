# Resumo técnico e estrutural — Nossa Lista (movies-app)

**Uso:** envie este arquivo (ou o conteúdo) para outra IA pedindo sugestões de melhorias, incrementos ou revisão arquitetural. O projeto é um app de filmes/séries para um casal, em português (pt-BR).

---

## 1. Visão geral

App **“Nossa Lista”** — catálogo pessoal de filmes e séries para um **casal em um único tenant local** (sem multi-login / multi-tenant). Integração forte com **TMDB**. Dados próprios em **SQLite** com **Flask + SQLAlchemy**. A interface principal é **React 18 + TypeScript**, empacotada com **Vite** como **múltiplas ilhas** (um bundle por rota), montadas em páginas **Jinja2** servidas pelo Flask. Complementos: **CSS global**, **HTMX** e **JavaScript legado** (`app/static/app.js`) para shell (drawer, perfil ativo, etc.). Servidor WSGI com **Gunicorn**; scripts em `deploy/` (incluindo Raspberry Pi).

---

## 2. Stack e linguagens

| Camada | Tecnologias |
|--------|-------------|
| Backend | Python 3, Flask ≥3, Flask-SQLAlchemy, Flask-Caching, requests, tenacity, `google-genai` (sugestões), gunicorn |
| Dados | SQLite (`instance/movies.db`), modelos em `app/models.py` |
| Frontend | TypeScript, React 18, Vite 5, Framer Motion, Lucide React, Recharts, @base-ui-components/react |
| Templates | Jinja2 (`app/templates/`), `base.html` com bottom nav, drawer, PWA-ish (manifest, service worker) |
| APIs externas | TMDB (metadados/posters); Google Gemini em fluxos de sugestão |

Dependências Python: ver `app/requirements.txt`. Dependências Node: ver `frontend/package.json`.

---

## 3. Arquitetura de frontend (ilhas Vite)

- **Configuração:** `frontend/vite.config.ts`
- **Build:** `rollupOptions.input` com múltiplos entries, por exemplo: `chrome`, `home`, `details`, `suggestions`, `history`, `watchLater`, `calendar`, `stats`, `swipe`, `bets`, `betDetail`, `map`, `season`, `person`, `collection`, `technical`, `welcome`, `comparar`, `perfil`, `conquistas`.
- **Saída:** `app/static/build/` + `manifest.json` — o Flask injeta as tags via helper `vite_entry_tags()`.
- **Desenvolvimento:** Vite com proxy para o Flask (`/api/`, `/search`, etc.).
- **Design system:** `frontend/src/ds/` — componentes reutilizáveis (ex.: `SurfacePanel`, `MagneticButton`, `Toast`, cards com tilt).
- **Estilos:** por página em `frontend/src/styles/*.css`; descrição de produto no `package.json` (“Liquid Glass 2026”, etc.).

---

## 4. Backend monolítico (`app/app.py`)

Monólito Flask com rotas HTML + JSON. Áreas funcionais principais (não exaustivo):

- **Home / feed:** `GET /`, `GET /api/home/feed`
- **Histórico / assistidos:** modelo `WatchedItem` (notas, temporadas); rotas `GET /historico`, `GET /api/history`
- **Ver depois:** `WatchLaterItem`; `GET /assistir-depois`, `GET /api/watch-later`, endpoints add/remove
- **Busca:** `/search`, `/search/keyword`, `/search/smart` — busca híbrida (`app/services/smart_search_service.py`; ADR em `docs/adr/001-busca-hibrida.md`)
- **Detalhes / ficha técnica / pessoa / coleção:** páginas HTML + `GET /api/details/...`, `api_technical`, `api_person`, `api_collection`
- **Sugestões:** página + POSTs (`random`, `gemini`, `keywords`); modo “hoje” com anti-repetição (`TodayPick`)
- **Diário “Assistimos hoje”:** `DailyWatchEntry`, `TvEpisodeMark`
- **Swipe casal:** `SwipeSession` (deck em JSON, cursores **por perfil** `cursor_index_a` / `cursor_index_b`), `SwipeItem` (máquina de estados + `vote_a` / `vote_b`), `SwipeSessionMatch` para matches por sessão; APIs como `POST/GET /api/swipe/session`, `POST /api/swipe/action`, `GET /api/swipe/session/matches`, legado `GET /api/swipe/deck`; FSM em `app/services/swipe_fsm.py` (ADR: `docs/adr/003-swipe-casal.md`)
- **Perfil ativo (sessão Flask):** `GET/POST /api/active-profile` — alinhado ao fluxo “quem está usando” no shell (Princesinha/Gabe ou labels configuráveis)
- **Gamificação:** XP, ledger, conquistas, eventos, temporadas (`GameSeason`, `SeasonProfileScore`), apostas (`WatchBet`); rotas sob `/api/gamification/...`, `/api/bets/...`, páginas conquistas / perfil / apostas
- **Comparar / mapa:** `GET /comparar`, `GET /api/comparar`; mapa de países (`api_map_countries` + serviços)
- **Trivia:** cache `TriviaCache`, `GET /api/trivia/...`
- **Observabilidade:** `GET /healthz`, `GET /metrics` (ver `docs/METRICS.md`)

---

## 5. Modelo de dados (resumo)

Definidos em `app/models.py`:

- **Catálogo pessoal:** `WatchedItem` (constraint única `tmdb_id` + `media_type`), `WatchLaterItem`
- **Casal:** `Couple`, `Profile` (slug `a`/`b`, `display_name`)
- **Swipe:** `SwipeItem`, `SwipeSession`, `SwipeSessionMatch`
- **Sugestões / diário:** `TodayPick`, `DailyWatchEntry`, `TvEpisodeMark`
- **Busca semântica:** `MediaEmbedding`
- **Gamificação:** `WatchProfileRating`, `GamificationEvent`, `AchievementProgress`, `XpLedgerEntry`, `CoupleXpState`, `WatchBet`, `GameSeason`, `SeasonProfileScore`
- **Outros:** `TriviaCache`

Estados típicos de `SwipeItem` (conceito): `pending`, `liked_a`, `liked_b`, `rejected_a`, `rejected_b`, `matched`, `rejected`, `no_match` — com votos independentes por perfil onde aplicável.

---

## 6. UI/UX e navegação

- **Shell:** `app/templates/base.html` — header com drawer, logo, saudação e diálogo “Quem está usando agora?”; **bottom navigation:** Assistir, Histórico, Ver depois, Swipe, Perfil (condicional à gamificação v2).
- **Primeiro uso / bem-vindo:** `/bem-vindo` + entry React `welcome`.
- **Swipe:** deck animado (like/rejeitar); painel de **matches da sessão**; intencionalmente **sem** revelar no card quem curtiu primeiro (surpresa no match).
- **Polish:** ARIA em drawer/dialog, suporte a reduced motion em partes do app, toasts globais.

---

## 7. Serviços e pastas relevantes

| Caminho | Papel |
|---------|--------|
| `app/services/swipe_fsm.py` | Transições de estado do swipe |
| `app/services/tmdb_cached.py`, `http_resilience.py` | TMDB com cache e resiliência |
| `app/services/smart_search_service.py` | Busca híbrida |
| `app/gamification/` | Motor, eventos, apostas, temporadas, XP, feature flags |
| `app/tests/` | Testes pytest |

---

## 8. Documentação interna existente

- `docs/adr/001-busca-hibrida.md`, `002-cache-resiliencia.md`, `003-swipe-casal.md`
- `docs/DESIGN_SPEC_PHASE2.md`, `docs/FLAGS_PHASE2.md`, `docs/SEARCH_QUALITY.md`, `docs/CHECKLIST_PREMIUM.md`, `docs/METRICS.md`

---

## 9. Árvore lógica (alto nível)

```
Flask (app/app.py)
├── Rotas HTML (Jinja) → CSS global + entrada Vite (ilha React)
├── API JSON (/api/...) → SQLAlchemy + serviços (TMDB, Gemini, gamificação)
└── Static (build Vite, app.js, style.css)

Frontend (por rota)
├── frontend/src/entries/*.tsx → components/*App.tsx
├── frontend/src/ds/ (design system)
└── frontend/src/styles/*.css
```

---

## 10. Contexto de produto (para sugestões)

- App **íntimo / casal:** comparar gostos, apostar nota antes de assistir, swipe para decidir juntos, conquistas e mapa a partir de metadados TMDB.
- **Restrição de desenho:** um casal por instância; perfis A/B por sessão/dispositivo, não contas OAuth multi-usuário.
- **Eixos úteis para a outra IA:** priorizar melhorias por impacto vs esforço (sync multi-dispositivo, privacidade, onboarding, acessibilidade, performance de decks grandes, testes E2E, i18n, notificações, etc.).

---
