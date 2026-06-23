// Loading skeleton: shimmering placeholder cards shaped like hive rows.
// Calm, on-brand alternative to a spinner for first paint (style guide §11.4).

interface Props {
  rows?: number;
}

export default function ListSkeleton({ rows = 4 }: Props) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="oa-card p-4 flex items-center gap-4">
          <div className="oa-skeleton" style={{ width: 56, height: 56, borderRadius: 14 }} />
          <div className="flex-1 flex flex-col gap-2">
            <div className="oa-skeleton" style={{ width: '55%', height: 16 }} />
            <div className="oa-skeleton" style={{ width: '35%', height: 12 }} />
          </div>
          <div className="oa-skeleton" style={{ width: 48, height: 28, borderRadius: 8 }} />
        </div>
      ))}
    </div>
  );
}
