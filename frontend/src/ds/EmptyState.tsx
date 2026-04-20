import type { ReactNode } from "react";
import { cx } from "./cx";

export interface EmptyStateProps {
  emoji?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ emoji = "🎬", title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx("rx-empty", className)}>
      <span className="rx-empty-emoji" aria-hidden="true">{emoji}</span>
      <h3 className="rx-empty-title">{title}</h3>
      {description ? <p className="rx-empty-desc">{description}</p> : null}
      {action ? <div className="rx-empty-action">{action}</div> : null}
    </div>
  );
}
