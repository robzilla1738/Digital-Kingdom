/**
 * LP16-A1: versioned layout history. Every saved scene that changes the layout (new graph revision, applied proposal or
 * an intentional reflow) appends one row: the layout version, the scene digest and a room-by-room diff against the
 * scene it replaced. Rows are append-only; a reflow is previewed first (GET …/scene/reflow/preview) and the apply can be
 * bound to that preview digest. Layout is presentation only and never a security fact.
 */
export const WORLD_LAYOUT_MIGRATION = `
CREATE TABLE scene_layouts (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, layout_version INTEGER NOT NULL, graph_revision TEXT NOT NULL, scene_digest TEXT NOT NULL, reason TEXT NOT NULL, diff TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX scene_layouts_project ON scene_layouts (project_id, id);
CREATE TRIGGER scene_layouts_append_only_u BEFORE UPDATE ON scene_layouts BEGIN SELECT RAISE(ABORT, 'scene layouts are append-only'); END;
CREATE TRIGGER scene_layouts_append_only_d BEFORE DELETE ON scene_layouts BEGIN SELECT RAISE(ABORT, 'scene layouts are append-only'); END;`;
export type LayoutReason = "graph" | "proposal" | "reflow";
