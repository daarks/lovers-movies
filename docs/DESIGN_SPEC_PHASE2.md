# Design spec — Fase 2 (UI cinematográfica)

## Tipografia

- Títulos fortes nas páginas de detalhe: **DM Serif Display** (Google Fonts, `font-display: swap`).
- Corpo e UI: **DM Sans** (já carregada em `base.html`).

## Tokens por gênero (`data-genre-theme`)

O `<body>` recebe `data-genre-theme` mapeado a partir do primeiro gênero TMDB (pt-BR) conhecido. Tokens CSS:

| Token (`data-genre-theme`) | Uso |
| --- | --- |
| `default` | Fallback roxo existente |
| `acao`, `terror`, `drama`, `comedia`, `ficcao`, `romance`, `suspense`, `aventura`, `animacao`, `crime`, `misterio`, `fantasia`, `documentario`, `familia`, `historia`, `musica`, `guerra`, `western`, `novela`, `reality`, `tv_movie` | `--genre-accent` e `--genre-glow` para sombras, poster tilt e cards |

Contraste: pares principais mantêm texto `#ffffff` sobre fundos `#000` / `#111`; acentos são para realce e bordas, não texto longo sobre o acento puro.

## Motion

- Durações recomendadas: 0,35–0,45 s em transições de UI; tilt do poster até 0,45 s.
- `prefers-reduced-motion: reduce`: animações e transições são colapsadas (regra global já existente em `style.css`).

## Componentes

- **Barra de XP**: `.profile-xp-bar` com faixa preenchida proporcional a `xp_into / xp_need`.
- **Comparador**: grid de duas colunas (uma em mobile) + lista de elenco comum.
- **Mapa**: chips por ISO com contagem de títulos assistidos com snapshot.
- **Avaliação dupla**: `.dual-rating-block` com duas linhas de estrelas (perfil A / B).

## HTMX e View Transitions

- HTMX 1.9.12 (CDN com SRI) em `base.html`.
- Fragmento: `GET /perfil/partials/xp-bar` com `hx-get` / `hx-trigger="every 45s"` no bloco da barra de XP.
- `meta name="view-transition"` em páginas de perfil, comparador e histórico (fluxo de navegação).

## Paleta do poster

- Fase 2 usa tokens derivados do gênero; amostragem Canvas do poster fica como extensão opcional (não bloqueante).
