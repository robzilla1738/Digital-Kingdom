# Security policy

## Reporting a vulnerability
Please report suspected vulnerabilities privately through GitHub's "Report a vulnerability" (Security Advisories) on this repository. Do not open public issues for security bugs. We aim to acknowledge reports within 5 working days.

## Scope and guarantees
Digital Kingdom is a **read-only evidence console**. In this version it:

- holds **no credentials** for monitored production systems and has **no** code path that changes them;
- records containment only as **proposals** that a different human-typed token must decide (service tokens can request, never decide; this proves distinct tokens, not distinct people); it never executes them;
- treats every event field, label, alias and model output as **untrusted data** (rendered as text, never as HTML or instructions);
- authorizes every API route on the server (viewer, analyst, admin), binds each source key to exactly one project and dataset kind, and refuses to mix synthetic and live data;
- minimizes and redacts every inbound record **before the first durable write** and never journals raw originals;
- limits each source to its assigned assets and permitted event categories.

## Deployment checklist
- Put TLS in front; set `DK_SECURE_COOKIES=true`.
- Set `DK_DEMO_MODE=false` for any deployment holding live data.
- Provide `DK_ADMIN_TOKEN` and `DK_SECRET` from a secret manager, or protect the `.data/` directory (it holds the export-signing secret).
- Bind to a private interface; the compose file binds to `127.0.0.1` by default.
- Issue least-privilege tokens: viewer tokens for read-only agents, analyst only where containment proposals are wanted.
- The optional AI planner (`DK_PLANNER_URL`) sends only asset ids, kinds and short names. Leave it unset to run fully offline.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for assets, trust boundaries and abuse cases.
