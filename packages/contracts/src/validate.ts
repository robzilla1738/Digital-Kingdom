import graphSchema from "../schemas/graph.schema.json" with { type: "json" };
import eventSchema from "../schemas/event.schema.json" with { type: "json" };
import ingestSchema from "../schemas/ingest-event.schema.json" with { type: "json" };
import sceneSchema from "../schemas/scene-proposal.schema.json" with { type: "json" };
// Precompiled from the schemas above (packages/contracts/scripts/generate-validators.ts): no runtime code
// generation, so validation also runs in the browser under a strict Content-Security-Policy.
import * as generated from "./generated/validators.js";
import type { Graph, IngestEvent, SceneProposal, SecurityEvent } from "./types.ts";

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

interface AjvError { instancePath?: string; message?: string; params?: Record<string, unknown> }
type GeneratedValidator = ((data: unknown) => boolean) & { errors?: AjvError[] | null };

export function formatErrors(errors: AjvError[] | null | undefined): string[] {
  return (errors ?? []).slice(0, 20).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}${e.params && "additionalProperty" in e.params ? ` (${String(e.params.additionalProperty)})` : ""}`);
}

function wrap<T>(fn: GeneratedValidator): (data: unknown) => ValidationResult<T> {
  return (data: unknown) => {
    const ok = fn(data);
    return ok ? { ok, value: data as T, errors: [] } : { ok, errors: formatErrors(fn.errors) };
  };
}

const g = generated as unknown as Record<string, GeneratedValidator>;
export const validateGraphSchema = wrap<Graph>(g.validateGraph!);
export const validateEventSchema = wrap<SecurityEvent>(g.validateEvent!);
export const validateIngestEventSchema = wrap<IngestEvent>(g.validateIngestEvent!);
export const validateSceneProposalSchema = wrap<SceneProposal>(g.validateSceneProposal!);

export const schemas = { graph: graphSchema, event: eventSchema, ingestEvent: ingestSchema, sceneProposal: sceneSchema };
