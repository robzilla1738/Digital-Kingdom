"""Validate the supplied planning fixtures, not a production security system.

Requires Python 3.10+ and the `jsonschema` package. Run from any working directory:
    python validate_examples.py

This validates example schemas, references, and selected scene proposal invariants.
It does not validate geometry, cryptographic evidence, collectors, or application behavior.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError

ROOT = Path(__file__).resolve().parent

def load(name: str):
    return json.loads((ROOT / name).read_text(encoding="utf-8"))

def validate_schema(schema: dict, data: dict) -> None:
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(data)

MODULE_BY_KIND = {
    "edge": "gatehouse", "auth": "guardhouse", "service": "hall",
    "worker": "workshop", "database": "vault", "agent": "observatory",
    "tool_server": "tool_annex", "pipeline": "forge",
}

def validate_scene(graph: dict, proposal: dict, schema: dict) -> None:
    validate_schema(schema, proposal)
    if proposal["graph_revision"] != graph["graph_revision"]:
        raise ValueError("Graph revision mismatch")
    assets = {asset["id"]: asset for asset in graph["assets"]}
    if len(assets) != len(graph["assets"]):
        raise ValueError("Duplicate asset IDs")
    membership = Counter(item["asset_id"] for item in proposal["placements"])
    if set(membership) != set(assets) or any(n != 1 for n in membership.values()):
        raise ValueError("Each fixture asset must appear exactly once")
    for item in proposal["placements"]:
        asset = assets[item["asset_id"]]
        if item["zone_id"] not in asset["allowed_zone_ids"]:
            raise ValueError("Disallowed zone")
        if item["module_id"] != MODULE_BY_KIND[asset["kind"]]:
            raise ValueError("Disallowed module for kind")


def main() -> None:
    graph = load("examples/graph.json")
    proposal = load("examples/scene-proposal.json")
    events = load("examples/events.json")
    records = load("examples/evidence.json")["records"]
    graph_schema = load("schemas/graph.schema.json")
    scene_schema = load("schemas/scene-proposal.schema.json")
    event_schema = load("schemas/event.schema.json")
    checks = []
    validate_schema(graph_schema, graph)
    checks.append("Graph schema and synthetic fixture pass")
    validate_scene(graph, proposal, scene_schema)
    checks.append("Scene schema, membership, allowed zones, and module constraints pass")
    assets = {asset["id"] for asset in graph["assets"]}
    edge_ids = set()
    for edge in graph["relationships"]:
        if edge["id"] in edge_ids:
            raise ValueError("Duplicate relationship IDs")
        edge_ids.add(edge["id"])
        if edge["source_id"] not in assets or edge["target_id"] not in assets:
            raise ValueError("Invalid relationship reference")
        if not set(edge["evidence_refs"]).issubset(records):
            raise ValueError("Missing relationship evidence")
    for asset in graph["assets"]:
        if not set(asset["source_refs"]).issubset(records):
            raise ValueError("Missing asset provenance")
    checks.append("Graph relationship and provenance references resolve")
    event_ids = set()
    for event in events:
        validate_schema(event_schema, event)
        if event["id"] in event_ids:
            raise ValueError("Duplicate fixture event ID")
        event_ids.add(event["id"])
        if event["project_id"] != graph["project_id"]:
            raise ValueError("Project mismatch")
        if not set(event["asset_ids"]).issubset(assets):
            raise ValueError("Missing event asset")
        if not set(event["evidence_refs"]).issubset(records):
            raise ValueError("Missing event evidence")
    checks.append(f"All {len(events)} synthetic events validate and resolve evidence")
    mutations = {}
    altered = deepcopy(proposal); altered["placements"][0]["asset_id"] = "invented-asset"
    mutations["invented asset"] = altered
    altered = deepcopy(proposal); altered["placements"].append(deepcopy(altered["placements"][0]))
    mutations["duplicate asset membership"] = altered
    altered = deepcopy(proposal); altered["placements"][0]["zone_id"] = "data"
    mutations["unauthorized zone"] = altered
    altered = deepcopy(proposal); altered["placements"][0]["module_id"] = "vault"
    mutations["incompatible module"] = altered
    altered = deepcopy(proposal); altered["attack_status"] = "compromised"
    mutations["model-supplied security status"] = altered
    altered = deepcopy(proposal); altered["script"] = "arbitrary code is prohibited"
    mutations["executable-content field"] = altered
    altered = deepcopy(proposal); altered["graph_revision"] = "wrong-revision"
    mutations["graph revision mismatch"] = altered
    altered = deepcopy(proposal); altered["placements"].pop()
    mutations["omitted asset"] = altered
    for label, altered in mutations.items():
        try:
            validate_scene(graph, altered, scene_schema)
        except (ValueError, ValidationError):
            checks.append(f"Rejected {label}")
        else:
            raise AssertionError(f"Incorrectly accepted: {label}")
    report = "# Planning package validation\n\n"
    report += "Executed against the supplied synthetic examples only.\n\n"
    report += "\n".join(f"- PASS: {check}" for check in checks)
    report += "\n\nNot tested: a working app, renderer, live collection, identity correlation, geometric layout, throughput, cryptographic evidence, production authorization, or real infrastructure.\n"
    (ROOT / "VALIDATION_REPORT.md").write_text(report, encoding="utf-8")
    print(report)

if __name__ == "__main__":
    main()
