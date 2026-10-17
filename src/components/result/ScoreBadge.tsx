import clsx from "clsx";

export const scoreColor = (score: number) => (score >= 80 ? "var(--good)" : score >= 60 ? "var(--warn)" : "var(--bad)");

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  return (
    <span
      className={clsx("rounded-full px-2 py-0.5 text-xs font-bold text-white shadow", className)}
      style={{ background: scoreColor(score) }}
    >
      {score}
    </span>
  );
}

/** Vòng tròn điểm tổng. */
export function ScoreRing({ score, label }: { score: number; label: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={`${label}: ${score}/100`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={scoreColor(score)}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-3xl font-bold" data-testid="overall-score">
            {score}
          </div>
          <div className="text-[11px] text-muted">{label}</div>
        </div>
      </div>
    </div>
  );
}
