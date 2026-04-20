import { Toggle } from "@base-ui-components/react/toggle";
import { ToggleGroup } from "@base-ui-components/react/toggle-group";
import { cx } from "./cx";

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  icon?: React.ReactNode;
}

export interface SegmentedToggleProps<V extends string> {
  value: V;
  onValueChange: (v: V) => void;
  options: SegmentedOption<V>[];
  ariaLabel?: string;
  className?: string;
}

/**
 * Toggle segmentado premium (glass) baseado no Base UI ToggleGroup.
 */
export function SegmentedToggle<V extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
}: SegmentedToggleProps<V>) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(vals) => {
        const next = Array.isArray(vals) ? (vals[0] as V | undefined) : undefined;
        if (next) onValueChange(next);
      }}
      aria-label={ariaLabel}
      className={cx("rx-segmented", className)}
    >
      {options.map((opt) => (
        <Toggle
          key={opt.value}
          value={opt.value}
          className={cx("rx-segmented-item", value === opt.value && "is-active")}
        >
          {opt.icon ? <span aria-hidden="true" className="rx-segmented-icon">{opt.icon}</span> : null}
          <span>{opt.label}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
