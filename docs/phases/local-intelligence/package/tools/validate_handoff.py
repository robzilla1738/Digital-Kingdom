#!/usr/bin/env python3
"""Validate this specification package only; never run services, call a model, or mutate a repo."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]

def read(path: str):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))

def semantic_errors(kind: str, value: dict) -> list[str]:
    errors: list[str] = []
    if kind == 'world-plan':
        resources = value['resources']
        ids = [r['id'] for r in resources]
        if len(ids) != len(set(ids)): errors.append('duplicate resources')
        byid = {r['id']: r for r in resources}
        visited: set[str] = set(); active: set[str] = set()
        def visit(i: str):
            if i not in byid: errors.append('unknown dependency'); return
            if i in active: errors.append('dependency cycle'); return
            if i in visited: return
            active.add(i)
            for dep in byid[i]['depends_on']: visit(dep)
            active.remove(i); visited.add(i)
        for rid in ids: visit(rid)
    elif kind == 'investigation-contract':
        scope = value['scope']
        if datetime.fromisoformat(scope['after'].replace('Z','+00:00')) >= datetime.fromisoformat(scope['before'].replace('Z','+00:00')):
            errors.append('unordered interval')
        states = {o['status'] for o in value['obligations']}
        if value['readiness'] == 'bounded_answer_ready' and not states <= {'satisfied','inapplicable_with_reason'}:
            errors.append('unfinished obligations')
        if value['readiness'] == 'unresolved_answer_ready' and states & {'not_started','running'}:
            errors.append('unattempted work is not a ready unresolved investigation')
    elif kind == 'repair-plan':
        expected = {'set_gateway_policy':'policy_ref','deactivate_test_token':'token_ref','remove_test_grant':'grant_ref','select_test_artifact':'artifact_ref','restart_test_observer':'observer_ref'}
        for action in value['actions']:
            if set(action['parameters']) != {expected[action['type']]}: errors.append('wrong action parameters')
    elif kind == 'verification-receipt':
        if value['security_verdict'] == 'pass':
            if {p['expectation'] for p in value['probes']} != {'prohibited','permitted'}: errors.append('missing positive or negative control')
            for p in value['probes']:
                required_effect = 'observed' if p['expectation']=='permitted' else 'not_observed'
                if p['result']!='as_expected' or p['observer_scope']!='sufficient' or p['actual_effect']!=required_effect or not p['evidence_refs']:
                    errors.append('unsupported verification pass')
        if value['overall_outcome']=='pass' and (value['security_verdict']!='pass' or value['cleanup']['outcome'] not in {'completed','not_needed'}):
            errors.append('unsupported overall pass')
    return errors

def main() -> int:
    failures: list[str] = []
    counts = {}
    try:
        import jsonschema
    except ImportError:
        print('Requires the jsonschema Python package. No network installation was attempted.', file=sys.stderr)
        return 2
    program=read('BACKLOG.json'); packages=program['work_packages']; byid={p['id']:p for p in packages}
    if len(byid)!=len(packages): failures.append('duplicate package ids')
    seen:set[str]=set(); active:set[str]=set()
    def visit(i:str):
        if i not in byid: failures.append('unknown package dependency '+i); return
        if i in active: failures.append('package dependency cycle '+i); return
        if i in seen:return
        active.add(i)
        for d in byid[i]['depends_on']:visit(d)
        active.remove(i);seen.add(i)
    for i in byid:visit(i)
    all_accept=[a for p in packages for a in p['acceptance']]
    acceptance=read('ACCEPTANCE.json')['requirements']
    if len({a['id'] for a in acceptance})!=len(acceptance):failures.append('duplicate requirement ids')
    if {a['id'] for a in all_accept}!={a['id'] for a in acceptance}:failures.append('requirement mismatch')
    if any(a['status']!='not_run' or a['evidence'] for a in acceptance):failures.append('spec pretends tests already ran')
    listed=[]
    for m in program['milestones']:
        listed+=m['packages']
        if not (ROOT/m['prompt']).is_file():failures.append('missing milestone prompt '+m['id'])
    if sorted(listed)!=sorted(byid):failures.append('milestone membership mismatch')
    scenarios=read('SCENARIOS.json')['families']
    if len({s['id'] for s in scenarios})!=len(scenarios):failures.append('duplicate scenarios')
    for s in scenarios:
        if s['status']!='not_run' or s['external_account_required']:failures.append('incorrect local scenario status '+s['id'])
        if not set(s['work_packages'])<=set(byid):failures.append('scenario has bad package ref '+s['id'])
    validators={}
    for p in sorted((ROOT/'contracts').glob('*.schema.json')):
        schema=json.loads(p.read_text())
        try:jsonschema.Draft202012Validator.check_schema(schema)
        except Exception as exc:failures.append(f'invalid schema {p.name}: {exc}');continue
        name=p.name.replace('.schema.json','')
        validators[name]=jsonschema.Draft202012Validator(schema,format_checker=jsonschema.FormatChecker())
        example=read('examples/'+name+'.json')
        problems=list(validators[name].iter_errors(example))
        if problems:failures.append('valid example fails '+name+': '+problems[0].message)
        if semantic_errors(name,example):failures.append('valid example semantics fail '+name)
    negatives=read('examples/invalid-contracts.json')
    for x in negatives:
        if not list(validators[x['contract']].iter_errors(x['data'])):failures.append('invalid example accepted '+x['name'])
    semneg=read('examples/invalid-semantics.json')
    for x in semneg:
        if list(validators[x['contract']].iter_errors(x['data'])):failures.append('semantic fixture not schema-valid '+x['name'])
        if not semantic_errors(x['contract'],x['data']):failures.append('semantic invalid accepted '+x['name'])
    # Confirm internal links from Markdown target existing files; skip web, anchors and proposed repo paths in code.
    import re
    for p in ROOT.rglob('*.md'):
        for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)',p.read_text()):
            if '://' in link or link.startswith('#'):continue
            target=link.split('#')[0]
            if target and not (p.parent/target).exists():failures.append(f'broken local link {p.relative_to(ROOT)}: {target}')
    manifest=ROOT/'FILE_MANIFEST.json'
    if manifest.exists():
        for entry in read('FILE_MANIFEST.json')['files']:
            p=ROOT/entry['path']
            if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=entry['sha256']:failures.append('manifest mismatch '+entry['path'])
    else:failures.append('manifest not yet generated')
    counts={'work_packages':len(packages),'milestones':len(program['milestones']),'acceptance_requirements':len(acceptance),'scenario_families':len(scenarios),'schemas':len(validators),'valid_contract_examples':len(validators),'rejected_schema_examples':len(negatives),'rejected_semantic_examples':len(semneg),'deferred_external_categories':len(read('DEFERRALS.json')['items'])}
    report={'scope':'handoff package only; no Digital Kingdom runtime, model, provider or browser test executed','status':'pass' if not failures else 'fail','counts':counts,'checks':['dependency DAG','requirement and milestone mapping','local scenario references','JSON Schema metaschema','illustrative example shapes','negative shape and semantic cases','local Markdown links','SHA-256 file manifest'],'failures':failures}
    print(json.dumps(report,indent=2))
    return 0 if not failures else 1

if __name__=='__main__':raise SystemExit(main())
