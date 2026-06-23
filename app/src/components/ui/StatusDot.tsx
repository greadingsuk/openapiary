// Status dot + label. Colour is ALWAYS paired with a text label so status is
// never conveyed by colour alone (style guide §11, accessibility).

import type { Freshness } from '../../lib/freshness';
import { freshnessDotClass, freshnessLabel } from '../../lib/freshness';

interface Props {
  freshness: Freshness;
  /** Optional override label (defaults to the freshness label). */
  label?: string;
}

export default function StatusDot({ freshness, label }: Props) {
  const text = label ?? freshnessLabel(freshness);
  return (
    <span className="inline-flex items-center gap-1.5" role="status">
      <span className={`oa-dot ${freshnessDotClass(freshness)}`} aria-hidden="true" />
      <span className="text-xs oa-muted">{text}</span>
    </span>
  );
}
