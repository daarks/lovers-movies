import { useEffect, useMemo, useState } from "react";
import { ToggleGroup } from "@base-ui-components/react/toggle-group";
import { Toggle } from "@base-ui-components/react/toggle";
import { Tooltip } from "@base-ui-components/react/tooltip";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles, Filter, Trophy, Lock, Unlock } from "lucide-react";
import { apiGet } from "../lib/api";
import type { AchievementItem } from "../lib/types";
import { classNames } from "../lib/utils";
import { GradientTitle, NumberTicker, ScrollReveal } from "../ds";

type GroupFilter = "all" | "geral" | "sazonal";
type StatusFilter = "all" | "unlocked" | "locked";

const RARITY_ORDER: Record<string, number> = {
  legendary: 1,
  epic: 2,
  rare: 3,
  seasonal: 4,
  common: 5,
};

function rarityLabelPt(rarity: string | undefined): string {
  switch ((rarity || "").toLowerCase()) {
    case "common":
      return "Comum";
    case "rare":
      return "Raro";
    case "epic":
      return "Épico";
    case "legendary":
      return "Lendário";
    case "seasonal":
      return "Sazonal";
    default:
      return rarity || "—";
  }
}

export default function ConquistasApp() {
  const [items, setItems] = useState<AchievementItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const reduce = useReducedMotion();

  useEffect(() => {
    const ctl = new AbortController();
    apiGet<{ enabled: boolean; items: AchievementItem[] }>(
      "/api/achievements/list",
      { signal: ctl.signal }
    )
      .then((data) => {
        setItems(data.enabled ? data.items || [] : []);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          setError((e as Error).message || "Erro ao carregar conquistas.");
        }
      });
    return () => ctl.abort();
  }, []);

  const stats = useMemo(() => {
    if (!items) return { total: 0, unlocked: 0, xp: 0 };
    const total = items.length;
    let unlocked = 0;
    let xp = 0;
    for (const it of items) {
      if (it.unlocked) {
        unlocked += 1;
        xp += it.xp_reward || 0;
      }
    }
    return { total, unlocked, xp };
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    return items
      .filter((i) => (groupFilter === "all" ? true : i.group === groupFilter))
      .filter((i) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "unlocked") return i.unlocked;
        return !i.unlocked;
      })
      .slice()
      .sort((a, b) => {
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        const ra = RARITY_ORDER[a.rarity] ?? 9;
        const rb = RARITY_ORDER[b.rarity] ?? 9;
        if (ra !== rb) return ra - rb;
        return (b.xp_reward || 0) - (a.xp_reward || 0);
      });
  }, [items, groupFilter, statusFilter]);

  if (error) {
    return (
      <div className="rx-root cq-main">
        <p className="cq-error">Erro: {error}</p>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="rx-root cq-main" aria-busy="true">
        <div className="cq-skeleton rx-panel" />
        <div className="cq-skeleton rx-panel" />
      </div>
    );
  }

  return (
    <Tooltip.Provider>
      <div className="rx-root cq-main">
        <ScrollReveal>
          <header className="cq-header cq-header--premium">
            <span className="cq-header-aura" aria-hidden="true" />
            <div className="cq-header-title">
              <motion.span
                className="cq-header-icon"
                aria-hidden="true"
                animate={reduce ? undefined : { rotate: [0, 5, -5, 0] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
              >
                <Trophy size={22} />
              </motion.span>
              <h1 className="cq-title">
                <GradientTitle as="span" size="xl" variant="gold" shiny>
                  Conquistas do casal
                </GradientTitle>
              </h1>
            </div>
            <div className="cq-stats">
              <div className="cq-stat">
                <span className="cq-stat-num">
                  <NumberTicker value={stats.unlocked} />
                </span>
                <span className="cq-stat-label">Desbloqueadas</span>
              </div>
              <div className="cq-stat">
                <span className="cq-stat-num">
                  <NumberTicker value={stats.total} />
                </span>
                <span className="cq-stat-label">Total</span>
              </div>
              <div className="cq-stat">
                <span className="cq-stat-num">
                  +<NumberTicker value={stats.xp} />
                </span>
                <span className="cq-stat-label">XP ganho</span>
              </div>
            </div>
          </header>
        </ScrollReveal>

        <div className="cq-filters rx-panel">
          <div className="cq-filter-row">
            <span className="cq-filter-label">
              <Filter size={14} aria-hidden="true" /> Tipo
            </span>
            <ToggleGroup
              value={[groupFilter]}
              onValueChange={(v) =>
                setGroupFilter(((v[0] as GroupFilter) ?? "all") as GroupFilter)
              }
              className="cq-toggle-group"
            >
              <Toggle value="all" className="cq-toggle" aria-label="Tudo">
                Tudo
              </Toggle>
              <Toggle value="geral" className="cq-toggle">
                Geral
              </Toggle>
              <Toggle value="sazonal" className="cq-toggle">
                Sazonal
              </Toggle>
            </ToggleGroup>
          </div>
          <div className="cq-filter-row">
            <span className="cq-filter-label">
              <Sparkles size={14} aria-hidden="true" /> Estado
            </span>
            <ToggleGroup
              value={[statusFilter]}
              onValueChange={(v) =>
                setStatusFilter(((v[0] as StatusFilter) ?? "all") as StatusFilter)
              }
              className="cq-toggle-group"
            >
              <Toggle value="all" className="cq-toggle">
                Tudo
              </Toggle>
              <Toggle value="unlocked" className="cq-toggle">
                Desbloqueadas
              </Toggle>
              <Toggle value="locked" className="cq-toggle">
                Pendentes
              </Toggle>
            </ToggleGroup>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-muted cq-empty">Nenhuma conquista com esses filtros.</p>
        ) : (
          <ul className="cq-grid" role="list">
            {filtered.map((a, idx) => {
              const pct = a.target > 0
                ? Math.min(100, Math.round((100 * a.progress) / a.target))
                : 0;
              return (
                <motion.li
                  key={a.id}
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: Math.min(idx, 8) * 0.04, ease: [0.22, 0.61, 0.36, 1] }}
                  whileHover={reduce ? undefined : { y: -3 }}
                  className={classNames(
                    "cq-card rx-panel",
                    a.unlocked && "cq-card--unlocked",
                    a.rarity && `cq-card--${a.rarity}`
                  )}
                >
                  <div className="cq-card-head">
                    <span className="cq-card-icon" aria-hidden="true">{a.icon}</span>
                    <div className="cq-card-title-block">
                      <h3 className="cq-card-title">{a.title}</h3>
                      <div className="cq-card-tags">
                        <span className={classNames("rx-chip", a.rarity && `rx-chip--${a.rarity}`)}>
                          {rarityLabelPt(a.rarity)}
                        </span>
                        {a.group === "sazonal" && (
                          <span className="rx-chip rx-chip--gold">Sazonal</span>
                        )}
                      </div>
                    </div>
                    <Tooltip.Root>
                      <Tooltip.Trigger
                        className="cq-card-state"
                        aria-label={a.unlocked ? "Desbloqueada" : "Pendente"}
                      >
                        {a.unlocked ? <Unlock size={16} /> : <Lock size={16} />}
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Positioner sideOffset={6}>
                          <Tooltip.Popup className="cq-tooltip">
                            {a.unlocked ? "Já garantida" : "Ainda não desbloqueada"}
                          </Tooltip.Popup>
                        </Tooltip.Positioner>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  </div>
                  <p className="cq-card-desc">{a.description}</p>
                  {a.unlocked ? (
                    <p className="cq-card-reward">+{a.xp_reward} XP · desbloqueada</p>
                  ) : (
                    <>
                      <div className="cq-card-progress" aria-hidden="true">
                        <div
                          className="cq-card-progress-bar"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="cq-card-progress-label">
                        {a.progress} / {a.target} · +{a.xp_reward} XP
                      </p>
                    </>
                  )}
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
    </Tooltip.Provider>
  );
}
