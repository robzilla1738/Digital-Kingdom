import type { ReactNode } from "react";
import { Icon } from "../../lib/icons.tsx";

/** Secondary explanation stays available without competing with the current task. */
export function ContextNote({ title, children, id, open, onOpenChange }: { title: string; children: ReactNode; id?: string; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return <details id={id} className="context-note" open={open} onToggle={event => onOpenChange?.(event.currentTarget.open)}><summary><Icon name="info" size={14} /><span>{title}</span><Icon name="chevron-down" size={14} /></summary><div className="scope-note">{children}</div></details>;
}
