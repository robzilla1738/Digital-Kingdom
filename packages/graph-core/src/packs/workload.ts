/**
 * R09.2 workload, serverless, queue and runtime pack (fixture-validated; live clusters need authorized access).
 *
 * - An instance lifetime is identified by more than a reused number: a process by (node, pid, start time), a pod by
 *   its uid, a function invocation by its request id. The same pid on the same node with a different start time is
 *   a different lifetime and is never joined.
 * - Producer and consumer of the same queue are ADJACENT; message lineage needs the same message id observed on
 *   both sides.
 * - Nodes without a runtime sensor are listed as coverage gaps.
 * - Logical workloads keep stable slots; replicas are a count inside the slot, so scaling never moves services.
 */
export interface RuntimeObservation { node: string; pid: number; process_start: string; pod_uid?: string; workload: string; event: string; at: string }
export function lifetimes(obs: RuntimeObservation[]) {
  const by = new Map<string, { key: string; workload: string; node: string; pid: number; started: string; events: string[] }>();
  for (const o of obs) {
    const key = o.pod_uid ? `pod:${o.pod_uid}/pid:${o.pid}@${o.process_start}` : `node:${o.node}/pid:${o.pid}@${o.process_start}`;
    const cur = by.get(key) ?? { key, workload: o.workload, node: o.node, pid: o.pid, started: o.process_start, events: [] };
    cur.events.push(`${o.at} ${o.event}`);
    by.set(key, cur);
  }
  return [...by.values()];
}

export interface QueueSide { queue: string; workload: string; role: "producer" | "consumer"; message_ids?: string[] }
export function queueRelations(sides: QueueSide[]) {
  const out: { producer: string; consumer: string; queue: string; relation: "adjacent" | "lineage_observed"; shared_message_ids: number; note: string }[] = [];
  for (const p of sides.filter((s) => s.role === "producer")) for (const c of sides.filter((s) => s.role === "consumer" && s.queue === p.queue)) {
    const shared = (p.message_ids ?? []).filter((id) => (c.message_ids ?? []).includes(id)).length;
    out.push({ producer: p.workload, consumer: c.workload, queue: p.queue, relation: shared ? "lineage_observed" : "adjacent", shared_message_ids: shared, note: shared ? `${shared} message id(s) seen at both ends` : "both use the queue; no message is shown to pass between them" });
  }
  return out;
}

export function nodeCoverage(nodes: string[], sensorNodes: string[]) {
  const missing = nodes.filter((n) => !sensorNodes.includes(n));
  return { covered: nodes.filter((n) => sensorNodes.includes(n)), missing, note: missing.length ? `${missing.length} node(s) without a runtime sensor: workloads scheduled there are unobserved` : "every listed node reports a sensor (not proof that every event is seen)" };
}

/** Stable slot per logical workload: order of first declaration, never replica count. */
export function workloadSlots(previous: Record<string, number>, workloads: { name: string; replicas: number }[]) {
  const slots = { ...previous };
  let next = Math.max(-1, ...Object.values(slots)) + 1;
  for (const w of workloads) if (!(w.name in slots)) slots[w.name] = next++;
  return { slots, drawn: workloads.map((w) => ({ workload: w.name, slot: slots[w.name]!, replicas: w.replicas })) };
}

/** Falco-compatible runtime event semantics: what the alert does and does not say. */
export function runtimeAlertSemantics(rule: string, output_fields: Record<string, unknown>) {
  return { rule, observed: "a syscall pattern matched a rule on this node", not_established: ["that the process was malicious", "that data left the host", "which human, if any, started it"], identity: output_fields["k8s.pod.uid"] ? "pod uid" : output_fields["proc.pid"] ? "node+pid only (pair with start time before joining)" : "none" };
}
