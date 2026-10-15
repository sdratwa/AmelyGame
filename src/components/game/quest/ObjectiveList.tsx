import type { ObjectiveProgress } from "@/lib/game/engine";
import { cn } from "@/lib/utils";

export function ObjectiveList({
  objectives,
  testId,
  compact = false,
}: {
  objectives: ObjectiveProgress[];
  testId?: string;
  compact?: boolean;
}) {
  return (
    <ul data-testid={testId} className={cn("space-y-1", compact ? "text-xs" : "text-sm")}>
      {objectives.map((o) => (
        <li
          key={o.id}
          data-testid={`objective-${o.id}`}
          data-done={o.done}
          className={cn("flex items-start gap-2", o.done ? "text-emerald-300" : "text-slate-100")}
        >
          <span aria-hidden className="mt-px w-4 shrink-0 text-center">
            {o.done ? "✓" : "○"}
          </span>
          <span className={cn("min-w-0 flex-1", o.done && "line-through decoration-emerald-300/50")}>{o.title}</span>
          {o.target > 1 && (
            <span className="shrink-0 tabular-nums text-slate-300">
              {o.current}/{o.target}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
