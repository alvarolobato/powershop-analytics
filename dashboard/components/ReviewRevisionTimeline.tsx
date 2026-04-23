"use client";

export interface RevisionChip {
  id: number;
  revision: number;
  generation_mode: string;
  created_at: string;
}

export interface ReviewRevisionTimelineProps {
  revisions: RevisionChip[];
  selectedId: number;
  onSelect: (id: number) => void;
}

export function ReviewRevisionTimeline({
  revisions,
  selectedId,
  onSelect,
}: ReviewRevisionTimelineProps) {
  if (revisions.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-2 items-center" data-testid="revision-timeline">
      <span className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
        Versiones:
      </span>
      {revisions.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onSelect(r.id)}
          className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
            r.id === selectedId
              ? "border-blue-500 bg-blue-500/20 text-blue-200"
              : "border-tremor-border dark:border-dark-tremor-border text-tremor-content dark:text-dark-tremor-content hover:bg-tremor-background-subtle"
          }`}
          data-testid={`revision-chip-${r.revision}`}
        >
          v{r.revision} ({r.generation_mode})
        </button>
      ))}
    </div>
  );
}
