"""Read-only credential-marker scan plus Git publication-boundary audit.

Only marker counts and paths are written, never credential values. This is not a
complete secret detector. Run from any directory; raw artifacts remain local.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import zipfile
from datetime import datetime, timezone

repo = Path(__file__).resolve().parents[3]
root = repo / 'artifacts/redesign'
paths = sorted(path for path in root.rglob('*') if path.is_file())
relative = [path.relative_to(repo).as_posix() for path in paths]
ignored_output = subprocess.run(['git', 'check-ignore', '--stdin', '-z'], cwd=repo,
    input=('\0'.join(relative) + '\0').encode(), stdout=subprocess.PIPE, check=False)
if ignored_output.returncode not in (0, 1):
    raise RuntimeError('Could not verify Git ignore boundaries')
ignored = set(ignored_output.stdout.decode().rstrip('\0').split('\0'))
tracked = set(subprocess.check_output(['git', 'ls-files', '-z', 'artifacts/redesign'], cwd=repo).decode().rstrip('\0').split('\0'))
patterns = {key: re.compile(value) for key, value in {
    'user_token': rb'dku_[A-Za-z0-9_-]{20,}',
    'service_token': rb'dks_svc_[A-Za-z0-9_-]{20,}',
    'session': rb'dksess_[A-Za-z0-9_-]{20,}',
    'source_token': rb'dks(?:_demo)?_[A-Za-z0-9_-]{20,}',
    'pilot_admin': rb'dk_pilot_[a-f0-9]{36}',
}.items()}
def markers(data):
    return {key: count for key, pattern in patterns.items() if (count := len(pattern.findall(data)))}

raw_inventory, public_findings, ignored_findings = [], [], []
for path, name in zip(paths, relative):
    raw = bool(re.search(r'\.(zip|webm|har|heapsnapshot|heapprofile|db|sqlite)([-.].*)?$', name)) or bool(re.search(r'/[^/]*test-results/', name))
    item = {'path': name, 'bytes': path.stat().st_size, 'gitIgnored': name in ignored, 'gitTracked': name in tracked}
    if raw:
        if path.suffix == '.zip':
            counts = {}
            with zipfile.ZipFile(path) as archive:
                for entry in archive.infolist():
                    if entry.file_size > 64 * 1024 * 1024:
                        raise RuntimeError(f'Raw archive entry requires separately bounded audit: {name}')
                    for key, count in markers(archive.read(entry)).items(): counts[key] = counts.get(key, 0) + count
            item['credentialMarkerCounts'] = counts
        raw_inventory.append(item)
        continue
    if path.suffix in ('.png', '.jpg', '.jpeg', '.woff', '.woff2'):
        continue
    if path.stat().st_size > 32 * 1024 * 1024:
        raise RuntimeError(f'Unexpected large non-raw file requires review: {name}')
    hits = markers(path.read_bytes())
    if hits:
        (ignored_findings if name in ignored else public_findings).append({**item, 'credentialMarkerCounts': hits})
violations = [item for item in raw_inventory if not item['gitIgnored'] or item['gitTracked']]
report = {
    'capturedAt': datetime.now(timezone.utc).isoformat(),
    'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'scan': 'Known credential-prefix counts only; no credential values emitted. This does not detect every possible secret.',
    'publicationPolicy': 'Publish reviewed synthetic screenshots, sanitized logs/results, metadata and reproduction scripts. Raw traces, HAR, video, heaps, databases and ephemeral test-results stay ignored and untracked.',
    'rawArtifacts': raw_inventory,
    'rawArtifactBytes': sum(item['bytes'] for item in raw_inventory),
    'publicTextFindings': public_findings,
    'ignoredTextFindings': ignored_findings,
    'publicationBoundaryViolations': violations,
    'passed': not public_findings and not violations,
}
(root / 'artifact-safety-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'passed': report['passed'], 'rawArtifacts': len(raw_inventory), 'rawBytes': report['rawArtifactBytes'], 'publicTextFindings': len(public_findings), 'ignoredTextFindings': len(ignored_findings), 'boundaryViolations': len(violations)}))
if not report['passed']:
    raise SystemExit('Publication audit requires remediation; do not stage flagged artifacts.')
