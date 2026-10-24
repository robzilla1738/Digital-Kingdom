# Local-only authority and safety contract

## Scope

The phase creates features and verifies them with owned disposable local resources. It does not authorize connections to third-party infrastructure, public scans, live account modifications, paid model calls, or deployment. Local support is not proof of external readiness.

## The authority hierarchy

1. The operator controls project-level configuration and can disable the local phase.
2. A launcher/supervisor allocates a run, directories, services and endpoint registry.
3. A service-viewer reads only authorized observed evidence.
4. A case-writing service may propose case changes and repairs but cannot approve itself.
5. A controller receives an expiring lease for exact run-owned actions.
6. An independent observer reports effects; it cannot grant authority.
7. A private referee grades a controlled experiment after the attempt; it cannot edit the case to make it correct.

Do not conflate a lab lease with human approval or assign a fake human principal to an autonomous test harness. Production-facing approval policy stays unchanged.

## Owned target identity

Free-form URLs, arbitrary paths and arbitrary process IDs cannot be execution targets. The controller resolves an allocated resource ID into a supervisor record containing run identity, endpoint, process ownership, expected receiver handshake and current revision.

A local hostname alone is insufficient: it can point to another process or be rebound. Verify effective connections; prohibit redirects, ambient proxy overrides, cloud metadata, LAN/public destinations and cross-run listeners. Do not accept a source report as permission to contact a URL contained in its text.

## Isolation levels

Trusted built-in host processes can provide a functional local demonstration under an explicitly documented trust model. That mode is not suitable for arbitrary generated code or adversarial subprocesses.

For stronger isolation, use an operator-launched rootless/minimally privileged container configuration where supported, dedicated internal networks, no host networking, no Docker socket exposed to the web server, no host root/home mounts, bounded volumes and no unnecessary capabilities. Verify connectivity and resource limits. Containers are not claimed to be an absolute security boundary.

The main app need not install a daemon, alter firewall rules or require root privileges to run the default scripted mode. If the necessary restriction cannot be enforced, disable arbitrary execution and stay with built-in declarative actions. Do not pretend an unenforced network policy is enforced.

Development dependency acquisition is separate from runtime behavior: pin versions and hashes, record installation, then test the local runtime with outbound integrations disabled. “No third-party account required” does not mean package installation never used a registry.

## Finite actions and limits

Allow only reviewed operations against synthetic resources: route request, queue operation, token issuance/use/deactivation in the lab issuer, grant change in the local model, gateway configuration replacement, artifact selection, observer stop/restart, snapshot and export. No shell, package install, generic HTTP proxy, path traversal or production credential rotation is part of the controller API.

Bound request count/rate, response bytes, body/decompression size, concurrent jobs, model/tool steps, resource count, memory, CPU, disk, log size and real elapsed time. Cancellation stops new actions, revokes leases, and initiates scoped cleanup. Deadlines use a monotonic clock independent of fixture time.

## Data and provenance

Synthetic people and secrets are labeled. Do not deliberately copy real credentials into a local scenario. Minimize before durable writes, including error messages and observer logs. Capsules exclude authentication tokens and source keys. Read-only evidence access remains sensitive.

Every event keeps source authority, event/receipt time, parser version, run reference and evidence origin. Never let an event payload declare its own trusted namespace or independence. Legacy schema migrations retain the previous evidence meaning.

## Prompt injection

All evidence strings, imported descriptors, tool descriptions and model outputs are untrusted. Never execute instructions from them, follow embedded URLs by default, or promote a quoted approval to authorization. A model may propose JSON matching an allowed schema; independent policy must authorize the resulting operation.

Separate investigator and builder conversations/permissions. A builder that knows the answer cannot be reused as a blinded investigator. Do not mount scenario-truth files into the agent’s workspace or expose them through debug endpoints. Screenshots and accessible DOM must not leak hidden answers to a vision-enabled agent.

## Idempotency and recovery

Journal planned action, idempotency key, target fingerprint and expected revision before execution. If a crash occurs between operation and receipt, reconcile actual state before retrying. Preserve partial application, failed compensation and unresolved verification.

Cleanup follows the supervisor manifest. Validate canonical paths and reject symlinks/hard links that escape it. Never delete a user directory because its name happens to match a run. Failed cleanup is separately visible and can require manual local recovery; it is not concealed by a successful security assertion.

## Model permissions and spending

Default mode is scripted. Existing-agent mode uses only the tools/route already available to that agent; this package does not grant extra provider authorization. An explicit remote-model configuration needs a current approved provider/model, data route, maximum committed cost, request reservation, concurrency limit and stop policy. Prior spending approval does not carry forward.

A local model endpoint is not automatically trusted. Restrict routing, credentials and payload size. A model error or timeout cannot stop ingestion or cause the backend to switch to another provider. Abort timed-out requests and preserve failed attempts.

## Future validation

External account interoperability, true provider enforcement, production latency, real-device performance, customer usefulness, human review and compliance remain deferred. Local reports cannot erase those entries. Deferral does not prevent completing the ordinary engineering and local-loop features in this phase.
