// Brand tab icons. Ionicons has no hive/apiary glyph, so these are simple
// honeycomb-derived SVGs that read as a single hive (Hives) and a cluster of
// hives (Fleet). Inherit currentColor so the tab bar tints them.

interface Props { size?: number; className?: string }

export function HiveIcon({ size = 24, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}
      fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <polygon points="12,3 19,7 19,15 12,19 5,15 5,7" />
      <line x1="5" y1="9" x2="19" y2="9" />
      <line x1="5" y1="13" x2="19" y2="13" />
    </svg>
  );
}

export function FleetIcon({ size = 24, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}
      fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden="true">
      <polygon points="8,3 12,5 12,10 8,12 4,10 4,5" />
      <polygon points="16,3 20,5 20,10 16,12 12,10 12,5" />
      <polygon points="12,12 16,14 16,19 12,21 8,19 8,14" />
    </svg>
  );
}
