# Flags de ambiente — Gamificação Fase 2

| Variável | Valores | Efeito |
| --- | --- | --- |
| `GAMIFICATION_V2` | `1`, `true`, `yes` (case-insensitive) | Liga motor de eventos, XP, conquistas, rotas `/perfil`, links no header, métricas extra. Desligado: `/perfil` e APIs `/api/gamification/*` respondem **404**; formulário de detalhes continua a gravar snapshot e notas por perfil quando enviados. |
| `BETS_ENABLED` | omisso ou `1` = ligado; `0`, `false`, `no` = desligado | Só tem efeito se `GAMIFICATION_V2` estiver ligado. Desliga apostas, APIs de apostas e secção de apostas no perfil. |
| `SEASONS_ENABLED` | idem | Temporadas trimestrais e painel no perfil. |

## Rollback

1. Definir `GAMIFICATION_V2=0` (ou remover).
2. Migrações são apenas aditivas (colunas/tabelas novas); dados antigos permanecem.

## Métricas

`GET /metrics` inclui, com gamificação ligada, contagens aproximadas: `gamification_events_total`, `achievements_unlocked_total`.
