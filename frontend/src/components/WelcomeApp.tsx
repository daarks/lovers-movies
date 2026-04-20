import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Heart, Sparkles, UserRound, Popcorn, Film } from "lucide-react";
import { GradientTitle, MagneticButton, ScrollReveal, SurfacePanel } from "../ds";

interface WelcomeAppProps {
  labelA: string;
  labelB: string;
}

const ACTIVE_PROFILE_KEY = "movies_app_active_profile_slug";

export default function WelcomeApp({ labelA, labelB }: WelcomeAppProps) {
  const [pick, setPick] = useState<"a" | "b" | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    document.getElementById("welcome-root")?.removeAttribute("aria-busy");
  }, []);

  function choose(slug: "a" | "b") {
    setPick(slug);
    try {
      localStorage.setItem(ACTIVE_PROFILE_KEY, slug);
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      window.location.href = "/";
    }, 520);
  }

  return (
    <div className="welcome-root">
      <span className="welcome-bg-orb welcome-bg-orb--a" aria-hidden="true" />
      <span className="welcome-bg-orb welcome-bg-orb--b" aria-hidden="true" />

      <ScrollReveal>
        <SurfacePanel className="welcome-card" variant="hero" aura>
          <div className="welcome-eyebrow">
            <Film size={14} /> Cinema do casal
          </div>
          <h1 className="welcome-title">
            <GradientTitle as="span" size="display" variant="rose" shiny>
              Quem está usando agora?
            </GradientTitle>
          </h1>
          <p className="welcome-hint">
            Usamos isso para Swipe, apostas e conquistas.
            <br />
            Pode trocar depois no topo.
          </p>

          <div className="welcome-actions">
            <ProfileButton
              slug="a"
              label={labelA}
              emoji="🌸"
              color="rose"
              active={pick === "a"}
              disabled={pick !== null}
              onPick={() => choose("a")}
              reduce={reduce}
            />
            <motion.span
              className="welcome-vs"
              aria-hidden="true"
              animate={pick ? { scale: [1, 1.3, 0.9, 1], rotate: [0, 10, -10, 0] } : undefined}
              transition={{ duration: 0.6 }}
            >
              <Heart size={18} />
            </motion.span>
            <ProfileButton
              slug="b"
              label={labelB}
              emoji="🎬"
              color="violet"
              active={pick === "b"}
              disabled={pick !== null}
              onPick={() => choose("b")}
              reduce={reduce}
            />
          </div>

          <div className="welcome-hints">
            <span>
              <Sparkles size={12} /> XP compartilhado
            </span>
            <span>
              <Popcorn size={12} /> histórico em comum
            </span>
          </div>
        </SurfacePanel>
      </ScrollReveal>
    </div>
  );
}

interface ProfileButtonProps {
  slug: "a" | "b";
  label: string;
  emoji: string;
  color: "rose" | "violet";
  active: boolean;
  disabled: boolean;
  onPick: () => void;
  reduce: boolean | null;
}

function ProfileButton({ slug, label, emoji, color, active, disabled, onPick, reduce }: ProfileButtonProps) {
  return (
    <motion.div
      className={`welcome-pick welcome-pick--${color} ${active ? "is-active" : ""}`}
      whileHover={reduce || disabled ? undefined : { y: -4, scale: 1.02 }}
      animate={active ? { scale: [1, 1.06, 1] } : undefined}
      transition={{ duration: 0.5 }}
    >
      <MagneticButton
        className="welcome-pick-button"
        onClick={onPick}
        disabled={disabled}
        data-profile-slug={slug}
      >
        <span className="welcome-pick-emoji" aria-hidden="true">{emoji}</span>
        <span className="welcome-pick-label">{label}</span>
        <span className="welcome-pick-icon" aria-hidden="true">
          <UserRound size={14} />
        </span>
      </MagneticButton>
    </motion.div>
  );
}
