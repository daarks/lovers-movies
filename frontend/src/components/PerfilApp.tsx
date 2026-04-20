import { useEffect, useState } from "react";
import { Tabs } from "@base-ui-components/react/tabs";
import { Progress } from "@base-ui-components/react/progress";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles, Trophy, History, Users, Crown, Calendar } from "lucide-react";
import { apiGet } from "../lib/api";
import type { ProfileState } from "../lib/types";
import { classNames, formatDateBR } from "../lib/utils";
import { GradientTitle, NumberTicker, ScrollReveal } from "../ds";

function computeLevelPct(into: number, need: number) {
  if (!need) return 0;
  return Math.max(0, Math.min(100, Math.round((into / need) * 100)));
}

export default function PerfilApp() {
  const [state, setState] = useState<ProfileState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const ctl = new AbortController();
    apiGet<ProfileState>("/api/profile/state", { signal: ctl.signal })
      .then((data) => setState(data))
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          setError((e as Error).message || "Erro ao carregar perfil.");
        }
      });
    return () => ctl.abort();
  }, []);

  if (error) {
    return (
      <div className="rx-root pf-main">
        <p className="pf-error">Erro: {error}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="rx-root pf-main" aria-busy="true">
        <div className="pf-skeleton rx-panel" />
        <div className="pf-skeleton rx-panel" />
      </div>
    );
  }

  if (!state.enabled) {
    return (
      <div className="rx-root pf-main">
        <div className="rx-panel pf-panel-muted">
          <h1 className="pf-title">Perfil</h1>
          <p className="text-muted">Gamificação desativada. Ative a feature flag para ver nível, XP e conquistas.</p>
        </div>
      </div>
    );
  }

  const pct = computeLevelPct(state.level_into, state.level_need);

  return (
    <div className="rx-root pf-main">
      <ScrollReveal>
        <header className="pf-hero pf-hero--premium">
          <span className="pf-hero-aura" aria-hidden="true" />
          <div className="pf-hero-head">
            <motion.div
              className="pf-hero-icon"
              aria-hidden="true"
              animate={reduce ? undefined : { rotate: [0, -4, 4, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <Crown size={30} />
            </motion.div>
            <div className="pf-hero-title-block">
              <span className="rx-chip rx-chip--soft">{state.couple_label}</span>
              <h1 className="pf-title">
                <GradientTitle as="span" size="xl" variant="gold" shiny>
                  Nível {state.level} · {state.level_title}
                </GradientTitle>
              </h1>
              <p className="pf-lead">
                <NumberTicker value={state.total_xp} /> XP acumulados
              </p>
            </div>
          </div>
          <div className="pf-progress-wrap">
            <Progress.Root value={pct} className="pf-progress">
              <Progress.Track className="pf-progress-track">
                <Progress.Indicator className="pf-progress-bar" />
              </Progress.Track>
            </Progress.Root>
            <p className="pf-progress-label">
              {state.level_into} / {state.level_need} XP para o próximo nível
            </p>
          </div>
          {state.season && (
            <motion.a
              className="pf-season-strip"
              href="/temporada"
              whileHover={reduce ? undefined : { y: -2 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
            >
              <span className="pf-season-emoji" aria-hidden="true">{state.season.emoji}</span>
              <div className="pf-season-body">
                <span className="pf-season-label">
                  Temporada ativa · {state.season.label}
                </span>
                <strong className="pf-season-title">{state.season.title}</strong>
                <div className="pf-season-mini-progress" aria-hidden="true">
                  <motion.div
                    className="pf-season-mini-progress-bar"
                    initial={{ width: 0 }}
                    animate={{ width: `${state.season.progress_pct}%` }}
                    transition={{ duration: 1.1, ease: [0.22, 0.61, 0.36, 1] }}
                  />
                </div>
              </div>
              <Calendar size={16} aria-hidden="true" />
            </motion.a>
          )}
        </header>
      </ScrollReveal>

      <Tabs.Root defaultValue="conquistas" className="pf-tabs">
        <Tabs.List className="pf-tabs-list">
          <Tabs.Tab value="conquistas" className="pf-tab">
            <Trophy size={14} /> Conquistas
          </Tabs.Tab>
          <Tabs.Tab value="xp" className="pf-tab">
            <Sparkles size={14} /> XP recente
          </Tabs.Tab>
          <Tabs.Tab value="perfis" className="pf-tab">
            <Users size={14} /> Perfis
          </Tabs.Tab>
          <Tabs.Indicator className="pf-tabs-indicator" />
        </Tabs.List>

        <Tabs.Panel value="conquistas" className="pf-tab-panel">
          <section className="rx-panel">
            <h2 className="pf-subtitle">Conquistas recentes</h2>
            {state.recent_unlocks.length === 0 ? (
              <p className="text-muted">Nenhuma conquista desbloqueada ainda — hora de ver um filme.</p>
            ) : (
              <ul className="pf-ach-list" role="list">
                {state.recent_unlocks.map((u) => (
                  <li key={u.achievement_id} className="pf-ach-item">
                    <span className="pf-ach-icon" aria-hidden="true">{u.icon}</span>
                    <div className="pf-ach-body">
                      <strong className="pf-ach-title">{u.title}</strong>
                      <time
                        className="text-muted"
                        dateTime={u.unlocked_at || undefined}
                      >
                        {formatDateBR(u.unlocked_at)}
                      </time>
                    </div>
                    <span className={classNames("rx-chip", `rx-chip--${u.rarity}`)}>
                      {u.rarity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <a className="rx-btn rx-btn--ghost rx-btn--sm pf-see-all" href="/conquistas">
              Ver todas as conquistas
            </a>
          </section>
        </Tabs.Panel>

        <Tabs.Panel value="xp" className="pf-tab-panel">
          <section className="rx-panel">
            <h2 className="pf-subtitle">
              <History size={16} /> Histórico de XP
            </h2>
            {state.recent_xp.length === 0 ? (
              <p className="text-muted">Sem lançamentos ainda.</p>
            ) : (
              <ul className="pf-ledger" role="list">
                {state.recent_xp.map((e, idx) => (
                  <li key={`${e.created_at || idx}-${idx}`} className="pf-ledger-item">
                    <span className="pf-ledger-amt">+{e.amount}</span>
                    <span className="pf-ledger-reason">{e.reason_pt || e.reason}</span>
                    <time className="text-muted" dateTime={e.created_at || undefined}>
                      {formatDateBR(e.created_at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Tabs.Panel>

        <Tabs.Panel value="perfis" className="pf-tab-panel">
          <section className="rx-panel">
            <h2 className="pf-subtitle">Perfis e temporada</h2>
            {state.profiles.length === 0 ? (
              <p className="text-muted">Nenhum perfil configurado.</p>
            ) : (
              <ul className="pf-profiles" role="list">
                {state.profiles.map((p) => (
                  <li key={p.slug} className="pf-profile-card">
                    <span className="pf-profile-slug">{p.slug.toUpperCase()}</span>
                    <strong>{p.display_name}</strong>
                    <span className="rx-chip rx-chip--gold">
                      {p.season_points ?? 0} pts temporada
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}
