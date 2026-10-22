# Warmed project-switch memory diagnosis

This is a controlled local diagnostic, not the replacement release-candidate run.

- Before build: e5705562d3ee640d7cf43d26a6122edf639f452e
- After build: working-lifecycle-20261022T1908
- Working-source diff SHA-256: 26ec0e9a02e0390a56760961a3dbc494980bac3cbbdbfcae0fa235a644b31a16
- Chromium 141.0.7390.37, headless, SwiftShader requested, 1440×900, DPR 1.
- Both projects and both maps warmed twice; 40 switches per arm; 800ms settling followed by two explicit GC passes 100ms apart. Fresh context for each arm.
- No concurrent browser workload. Local seeded in-memory API only.

| Arm | Collected heap delta | Last 10 slope | DOM nodes at switch 10→40 | JS listeners at switch 10→40 |
|---|---:|---:|---:|---:|
| Before picker-transient-castle | 8.51MB | 190.2KB/switch | 2835→3525 | 5734→6034 |
| Before native-history-graph-only | 0.52MB | 6.6KB/switch | 2580→2580 | 2993→2993 |
| After picker-transient-castle | 1.84MB | 9.3KB/switch | 2523→2523 | 5608→5608 |
| After native-history-graph-only | 0.51MB | 5.8KB/switch | 2475→2475 | 2960→2960 |

R3F's 500ms delayed root teardown was a confounder, not the root cause: growth remained after settling. Shared cached geometry/materials retained per-renderer disposal listeners. Final module-owner cleanup now releases GPU registrations without rebuilding CPU geometry, and refreshes overlapping live renderers. Canvas teardown also disposes its renderer after effect cleanup, guarded against StrictMode replay.

All arms ended with one EventSource, zero pending fetches, and no page errors. After cleanup, Castle DOM/listener counts plateau; the late heap slope drops about 95%. Residual JS growth remains in both arms, so this is not a zero-leak or indefinite-duration proof. Native GPU memory and real-device frame performance are not established.
