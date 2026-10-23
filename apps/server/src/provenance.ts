import { LOCAL_CONTRACTS, LOCAL_LAB_LABEL, validateRunProvenance, type RunProvenance } from "@dk/contracts";
import { HttpError, type ProjectRow } from "./store.ts";

/**
 * LP03: project-level local run provenance. Stored in projects.meta.local_run (no table migration: `meta` is an
 * existing JSON column). Orthogonal to dataset_kind, which is never changed by it.
 */
export type ProjectProvenance =
  | (RunProvenance & { local_run: true; label: string; qualifiers: ["synthetic_data", "local_scope"] })
  | { schema: typeof LOCAL_CONTRACTS.run_provenance; local_run: false; note: string };

export function parseLocalRun(raw: unknown): RunProvenance {
  const v = validateRunProvenance(raw);
  if (!v.ok) throw new HttpError(422, "invalid local_run provenance", v.errors);
  return v.value!;
}

export function provenanceOf(p: Pick<ProjectRow, "meta">): ProjectProvenance {
  const lr = (p.meta as { local_run?: unknown } | undefined)?.local_run;
  if (lr !== undefined) {
    const v = validateRunProvenance(lr);
    if (v.ok) return { ...v.value!, local_run: true, label: v.value!.label ?? LOCAL_LAB_LABEL, qualifiers: ["synthetic_data", "local_scope"] };
    return { schema: LOCAL_CONTRACTS.run_provenance, local_run: false, note: "A stored local run record is invalid, so local provenance is NOT established; treat the data as of unknown origin." };
  }
  return { schema: LOCAL_CONTRACTS.run_provenance, local_run: false, note: "No local run provenance is recorded for this project; dataset_kind alone describes it." };
}
