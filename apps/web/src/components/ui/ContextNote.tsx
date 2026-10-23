import type { ReactNode } from "react";
import { Icon } from "../../lib/icons.tsx";

/** Secondary explanation stays available without competing with the current task. */
export function ContextNote({ title, children }: { title: string; children: ReactNode }) {
  return <details className="context-note"><summary><Icon name="info" size={14} /><span>{title}</span><Icon name="chevron-down" size={14} /></summary><div className="scope-note">{children}</div></details>;
}
