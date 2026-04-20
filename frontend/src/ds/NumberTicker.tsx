import { useEffect, useRef, useState } from "react";
import { animate, useInView } from "framer-motion";

export interface NumberTickerProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  startOnView?: boolean;
}

export function NumberTicker({
  value,
  duration = 1.2,
  format,
  className,
  prefix,
  suffix,
  decimals = 0,
  startOnView = true,
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (startOnView && !inView) return;
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 0.61, 0.36, 1],
      onUpdate(latest) {
        setDisplay(latest);
      },
    });
    return () => controls.stop();
  }, [value, duration, inView, startOnView]);

  const formatted = format ? format(display) : display.toFixed(decimals);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
