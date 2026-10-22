import { createContext } from "react";

/**
 * Two independent facts, kept separate on purpose:
 * - transport: is the SSE stream connected?
 * - sync: has the latest snapshot been applied since the last interruption?
 * The view is live only when BOTH hold. A connected stream with a pending or failed catch-up snapshot is
 * still stale data.
 */
export type Transport = "connecting" | "open" | "down";
export type SyncState = "synced" | "syncing" | "failed";
export type ConnectionState = "live" | "synchronizing" | "sync-failed" | "reconnecting" | "lost";
export interface Connection { state: ConnectionState; since: string | null }

export function deriveConnection(transport: Transport, sync: SyncState, serverReachable: boolean): ConnectionState {
  if (transport !== "open") return serverReachable ? "reconnecting" : "lost";
  if (sync === "synced") return "live";
  return sync === "syncing" ? "synchronizing" : "sync-failed";
}

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  live: "Streaming", synchronizing: "Synchronizing", "sync-failed": "Sync failed · retrying", reconnecting: "Reconnecting", lost: "Disconnected",
};
export const CONNECTION_BANNER: Record<Exclude<ConnectionState, "live">, string> = {
  synchronizing: "Reconnected; applying the catch-up snapshot.",
  "sync-failed": "Could not refresh the snapshot; retrying.",
  reconnecting: "Live updates interrupted; reconnecting.",
  lost: "Connection to the server lost.",
};

export const ConnectionCtx = createContext<Connection | null>(null);
