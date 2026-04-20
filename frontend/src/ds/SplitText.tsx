import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cx } from "./cx";

export interface SplitTextProps {
  text: string;
  className?: string;
  as?: "h1" | "h2" | "h3" | "span" | "p";
  stagger?: number;
  delay?: number;
  by?: "word" | "char";
}

/**
 * SplitText: divide o texto e aplica reveal escalonado via framer-motion.
 * `by="word"` respeita boas práticas de leitura (não quebra palavras).
 */
export function SplitText({
  text,
  className,
  as = "span",
  stagger = 0.05,
  delay = 0,
  by = "word",
}: SplitTextProps) {
  const reduced = useReducedMotion();
  const parts = useMemo(() => {
    if (by === "char") return Array.from(text);
    return text.split(/(\s+)/);
  }, [text, by]);

  const MotionTag = (motion as unknown as Record<string, (typeof motion)["span"]>)[as];

  if (reduced) {
    const Tag = as as "h1" | "h2" | "h3" | "span" | "p";
    return (
      <Tag className={className} aria-label={text}>
        {text}
      </Tag>
    );
  }

  return (
    <MotionTag
      className={cx(className)}
      aria-label={text}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.5 }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
    >
      {parts.map((token, idx) => (
        <motion.span
          key={`${idx}-${token}`}
          style={{ display: "inline-block", whiteSpace: token.trim() ? "normal" : "pre" }}
          variants={{
            hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
            visible: {
              opacity: 1,
              y: 0,
              filter: "blur(0px)",
              transition: { duration: 0.6, ease: [0.22, 0.61, 0.36, 1] },
            },
          }}
        >
          {token}
        </motion.span>
      ))}
    </MotionTag>
  );
}
