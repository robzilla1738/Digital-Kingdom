import { createContext } from "react";

/** Server live-update state. Anything other than "live" means the view may be stale. */
export interface Connection { state: "live" | "reconnecting" | "lost"; since: string | null }
export const ConnectionCtx = createContext<Connection | null>(null);
