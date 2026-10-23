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

## Deployment identity (roadmap R10.1)

- **SSO:** set `DK_OIDC_ISSUER`, `DK_OIDC_AUDIENCE` and `DK_OIDC_JWKS` (the issuer's JWKS document, pinned). `POST /api/session/oidc` accepts an ID token (RS256/ES256 only; never `none` or HMAC) and creates a session only for a subject an installation admin mapped with `POST /api/oidc-subjects`. Unmapping or changing a mapping revokes that subject's live sessions. Live verification against a real identity provider has not been performed.
- **Service credentials** expire (default 90 days) and rotate in place; rotation revokes the old secret and its sessions at once. Service tokens can never be admins or mint tokens.
- **TLS and proxies:** terminate TLS in front of the server and set `DK_SECURE_COOKIES=true`, or list the proxy in `DK_TRUSTED_PROXIES` so a forwarded `https` marks cookies Secure. Forwarded headers from any other peer are ignored.
- **Recovery:** `DK_DATA_DIR=... DK_RECOVERY_REASON="..." pnpm admin:recover` needs filesystem access to the database, mints one human installation-admin token valid for 24 hours and audits it. No API path grants emergency authority, so a monitored agent's credential cannot use it.
- **Browser storage:** the web app keeps the session in an HttpOnly cookie; a test fails if any code writes token-, key-, secret- or session-named values to local or session storage.
