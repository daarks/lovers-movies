import { useEffect, useState } from "react";

export interface TypewriterTitleProps {
  text: string;
  speed?: number;
  startDelay?: number;
  className?: string;
  caret?: boolean;
}

/**
 * Typewriter premium: digita um texto fixo com caret piscando.
 * Respeita prefers-reduced-motion (renderiza direto se o usuário preferir).
 */
export function TypewriterTitle({
  text,
  speed = 55,
  startDelay = 220,
  className,
  caret = true,
}: TypewriterTitleProps) {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(reduced ? text : "");

  useEffect(() => {
    if (reduced) {
      setShown(text);
      return;
    }
    let i = 0;
    let cancel = false;
    const start = setTimeout(function tick() {
      if (cancel) return;
      i += 1;
      setShown(text.slice(0, i));
      if (i < text.length) {
        setTimeout(tick, speed);
      }
    }, startDelay);
    return () => {
      cancel = true;
      clearTimeout(start);
    };
  }, [text, speed, startDelay, reduced]);

  return (
    <span className={className} aria-label={text} role="text">
      <span aria-hidden="true">{shown}</span>
      {caret ? <span className="rx-typewriter-caret" aria-hidden="true" /> : null}
    </span>
  );
}
