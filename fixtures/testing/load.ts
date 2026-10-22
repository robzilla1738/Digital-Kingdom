import { readFileSync } from "node:fs";
import type { Graph } from "../../packages/contracts/src/index.ts";
import type { Delivery, SourceConfig } from "../../packages/detections/src/index.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
export const demoGraph = (): Graph => read("demo/graph.json");
export const demoSources = (): SourceConfig[] => read("demo/sources.json");
export const demoDeliveries = (): Delivery[] => read("demo/deliveries.json");
export const legacyExample = (name: string) => JSON.parse(readFileSync(new URL(`../../docs/blueprint/examples/${name}`, import.meta.url), "utf8"));
