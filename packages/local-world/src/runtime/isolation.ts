import type { WorldPlan } from "@dk/contracts";
import { TEMPLATE_CATALOG, templateDigest, type WorldTemplate } from "../catalog.ts";

/**
 * LP05: execution-mode preflight. Every resource and network control is reported as enforced, checked (measured,
 * not a hard limit) or not enforced, and a mode whose required restriction cannot be enforced here is refused,
 * never silently downgraded. Host-process mode is explicitly `restricted`: only built-in declarative services run.
 */
export interface Control { control: string; state: "enforced" | "checked" | "not_enforced" | "not_applicable"; detail: string }
export interface Preflight { schema: "dk.local.preflight.v1"; mode: WorldPlan["runtime_mode"]; status: "restricted" | "refused"; reasons: string[]; controls: Control[]; arbitrary_execution: "disabled" }

export const MEMORY_CEILING_BYTES = 1_536 * 1024 * 1024;

export function preflight(plan: WorldPlan, o: { activeRuns: number; maxConcurrentRuns: number; services: Partial<Record<WorldTemplate, unknown>>; rssBytes?: number }): Preflight {
  const reasons: string[] = [];
  const rss = o.rssBytes ?? process.memoryUsage().rss;
  const controls: Control[] = [
    { control: "request_count", state: "enforced", detail: `at most ${plan.budget.max_requests} requests through the supervisor's action client` },
    { control: "parallel_operations", state: "enforced", detail: `at most ${plan.budget.max_parallel_operations} concurrent stimulus operations; more are refused` },
    { control: "response_and_evidence_bytes", state: "enforced", detail: `responses over 256 KB are refused; total ${plan.budget.max_evidence_bytes} bytes per run` },
    { control: "elapsed_time", state: "enforced", detail: `${plan.budget.max_seconds}s on the monotonic clock; scenario time cannot extend it` },
    { control: "concurrent_runs", state: "enforced", detail: `at most ${o.maxConcurrentRuns} active runs per supervisor` },
    { control: "resource_count", state: "enforced", detail: `${plan.resources.length} resources (schema maximum 32), built-in templates only` },
    { control: "run_disk", state: "enforced", detail: "files are written only through the run's owned-file API with a byte cap" },
    { control: "memory", state: "checked", detail: `supervisor RSS ${Math.round(rss / 1048576)} MB sampled against a ${MEMORY_CEILING_BYTES / 1048576} MB ceiling at start; not a cgroup limit` },
    { control: "cpu", state: "not_enforced", detail: "no CPU quota in host-process mode" },
  ];
  if (plan.runtime_mode === "trusted_builtin_processes") {
    controls.push(
      { control: "network_egress", state: "not_enforced", detail: "no OS-level egress filter: built-in services only reach declared dependencies through the supervisor, and the action client refuses every destination that is not a registered endpoint of the run" },
      { control: "isolation_boundary", state: "not_enforced", detail: "services share the supervisor process; this mode is for trusted built-in services only and cannot host untrusted or generated code" },
      { control: "container_runtime", state: "not_applicable", detail: "no container runtime or Docker socket is used" },
    );
  } else {
    reasons.push("operator_isolated_containers requires an operator-launched container profile with a verified per-container handshake; that launcher handshake is not implemented in this phase, and the supervisor never launches containers or uses a Docker socket. Review containerProfile(plan) or use trusted_builtin_processes.");
    controls.push({ control: "network_egress", state: "not_enforced", detail: "container network policy would be applied by the operator's runtime; it is not verified here" });
  }
  const missing = [...new Set(plan.resources.map((r) => r.template).filter((t) => t !== "observer" && !o.services[t as WorldTemplate]))];
  if (missing.length) reasons.push(`no built-in implementation for template(s) ${missing.join(", ")}`);
  if (o.activeRuns >= o.maxConcurrentRuns) reasons.push(`concurrent run limit ${o.maxConcurrentRuns} reached`);
  if (rss > MEMORY_CEILING_BYTES) reasons.push(`supervisor memory ${Math.round(rss / 1048576)} MB exceeds the ${MEMORY_CEILING_BYTES / 1048576} MB ceiling`);
  if (plan.external_network !== false) reasons.push("external network is never permitted");
  return { schema: "dk.local.preflight.v1", mode: plan.runtime_mode, status: reasons.length ? "refused" : "restricted", reasons, controls, arbitrary_execution: "disabled" };
}

/**
 * The OPTIONAL constrained container profile an operator could review and launch with their own runtime. It is
 * generated data only: no image is pulled and nothing is launched by Digital Kingdom. Images are the operator's
 * builds of the reviewed templates, identified by template digest.
 */
export function containerProfile(plan: WorldPlan) {
  const network = `dk-lab-${plan.plan_id.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
  const services: Record<string, Record<string, unknown>> = {};
  for (const r of plan.resources) {
    services[r.id] = {
      image: `dk-local-world/${r.template}@sha256:${templateDigest(r.template as WorldTemplate)}`,
      read_only: true, user: "65532:65532", cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], privileged: false,
      networks: [network], mem_limit: "128m", pids_limit: 64, cpus: 0.5, tmpfs: ["/tmp:size=8m,noexec,nosuid"],
      labels: { "dk.local.run_template": r.template, "dk.local.template_version": TEMPLATE_CATALOG[r.template as WorldTemplate].version },
    };
  }
  return {
    schema: "dk.local.container_profile.v1", launched_by: "operator", digital_kingdom_launches: false,
    networks: { [network]: { internal: true, driver: "bridge" } }, services,
    excluded: ["ports (no host publishing)", "volumes and host mounts", "docker.sock", "network_mode: host", "privileged", "env_file", "extends/include"],
    note: "Containers are not claimed to be an absolute security boundary. Verify connectivity and limits after launch.",
  };
}
