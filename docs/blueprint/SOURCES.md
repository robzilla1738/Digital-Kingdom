# Primary sources and claim boundaries

Reviewed for this design on October 21, 2026. Technology choices, schedules, capacity budgets, and product outcomes are proposals, not measured results. Source interfaces and plan availability can change; verify against pinned versions when implementing.

## S01. OpenTelemetry — service identity

https://opentelemetry.io/docs/specs/semconv/resource/service/

Supports distinguishing logical service namespace/name from individual instances.

## S02. OpenTelemetry — context propagation security

https://opentelemetry.io/docs/concepts/context-propagation/

Warns that external trace headers can be forged and propagated context can disclose information.

## S03. OpenTelemetry — handling sensitive data

https://opentelemetry.io/docs/security/handling-sensitive-data/

Supports minimization, redaction, and caution about hashing as anonymization.

## S04. OpenTelemetry — Collector resiliency

https://opentelemetry.io/docs/collector/resiliency/

Documents queues, retries, persistent storage, and remaining data-loss scenarios.

## S05. OpenTelemetry — trace SDK sampling

https://opentelemetry.io/docs/specs/otel/trace/sdk/

Sampling can discard traces; performance telemetry cannot be presumed complete.

## S06. Falco — output channels

https://falco.org/docs/concepts/outputs/

Existing runtime findings can be forwarded through supported outputs.

## S07. Falco — alert forwarding

https://falco.org/docs/concepts/outputs/forwarding/

Falcosidekick forwards JSON events and adds integration features.

## S08. Cilium/Hubble — observability

https://docs.cilium.io/en/stable/observability/hubble/index.html

Existing service dependency/flow mapping; requires the relevant installation and visibility.

## S09. OCSF — framework overview

https://ocsf.io/

Vendor-agnostic extensible event schema; useful interoperability target rather than storage architecture.

## S10. Kenney — Castle Kit

https://kenney.nl/assets/castle-kit

Lists 75 files and a Creative Commons CC0 license at review time.

## S11. Khronos — glTF

https://www.khronos.org/gltf/

Open delivery format for runtime 3D scenes/assets.

## S12. React Three Fiber — scaling performance

https://r3f.docs.pmnd.rs/next/advanced/scaling-performance

Documents reusable resources, instancing, detail levels, and adaptive performance.

## S13. ELK — layered layout

https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html

Graph ordering/routing and compound graph support; does not itself create castle geometry.

## S14. ELK — constraining layouts

https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html

Documents constraints and interactive layout; compiler stability still needs application-level tests.

## S15. Thinkst — AWS API Keys Canarytoken

https://docs.canarytokens.org/guide/aws-keys-token.html

Documents decoy credential use alerts and possible 2–30 minute upstream logging delay.

## S16. Cloudflare — Logpush

https://developers.cloudflare.com/logs/logpush/

Documents batch delivery, source limitations, and product/dataset-dependent availability. Use canonical docs, not preview deployments.

## S17. MCP — security best practices

https://modelcontextprotocol.io/docs/draft/tutorials/security/security_best_practices

Draft security guidance includes confused deputy, token handling, SSRF, and local server compromise; pin the supported protocol revision.

## S18. Docker — Engine security

https://docs.docker.com/engine/security/

Documents Docker daemon authority and associated host risks.

## S19. GitHub — artifact attestations

https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations

Supports build-provenance generation and verification; provenance is not proof of benign code.

## S20. Apache-2.0 license summary and text

https://choosealicense.com/licenses/apache-2.0/

Permissive license with notice and patent provisions; licensing choice is a project decision.

## S21. CycloneDX — VEX

https://www.cyclonedx.org/capabilities/vex/

Contextual exploitability statements can inform vulnerability review; they are not observed attacks.

## S22. Three.js — WebGLRenderer

https://threejs.org/docs/pages/WebGLRenderer

Current renderer documentation describes WebGL2 behavior and rendering diagnostics.
