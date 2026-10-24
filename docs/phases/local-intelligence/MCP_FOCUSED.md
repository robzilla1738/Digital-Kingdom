# Focused investigation MCP profiles (LP11)

The full MCP toolset (`apps/mcp/src/server.ts`, 23 tools) stays unchanged and is still the default. Setting
`DK_MCP_PROFILE` starts a focused server instead, built around the investigation contract loop:

```
dk_session -> dk_read_contract -> dk_next_step -> [dk_run_step] -> dk_get_packet / dk_inspect_refs -> dk_check_conclusion -> [dk_propose_conclusion]
```

| Profile | Token | Tools |
|---|---|---|
| `investigation-read` | project-scoped **service viewer** | `dk_session`, `dk_read_contract`, `dk_next_step`, `dk_get_packet`, `dk_inspect_refs`, `dk_check_conclusion`, `dk_job_status`, `dk_resume` |
| `investigation-author` | project-scoped **service analyst** | the read set + `dk_open_contract`, `dk_run_step`, `dk_mark_inapplicable`, `dk_propose_conclusion`, `dk_cancel_job` |

These map onto the phase package's `investigation-read` and `investigation-author` profiles. Neither has source
configuration, approval, containment, lease or executor rights; `lab-request` is not offered.

## Guarantees

- **Fixed at start**: profile, project, output budget (`DK_MCP_MAX_OUTPUT_BYTES`, default 200000) and units per call
  (`DK_MCP_MAX_UNITS_PER_CALL`, default 20, max 50). No tool takes a profile, project, budget-policy, approval, role,
  token or scope argument, so text in evidence or tool results cannot change them.
- **Server-enforced**: hiding tools is defence in depth. The Digital Kingdom server checks the token's role and project
  on every call: the author profile with a viewer token lists write tools but every write is refused (403), and
  `dk_session` warns about it.
- **Annotations**: read tools `readOnlyHint: true`; write tools `readOnlyHint: false` (all `openWorldHint: false`).
  `dk_get_packet` / `dk_inspect_refs` append to the exposure (access) log the claim checker uses for availability; they
  change no case, contract, job or conclusion.
- **Stable envelope** `dk.mcp_envelope.v1`: `{ envelope, tool, profile, project, ok, data, continuation, untrusted_fields,
  model_calls: 0, notes, bounded: { output_bytes, budget_bytes } }`; failures are `ok: false` with `error.code`.
  An output over the session budget is withheld (`output_budget`), never cut; packet requests are clamped to fit.
- **Resumable**: jobs commit after every unit; `continuation` names the next call (`dk_run_step` with `job_id`, or the
  next packet cursor). A new client process continues from `dk_resume` / `dk_job_status`; the server makes no model
  calls.

## Configuration for an existing coding agent

```
npx tsx scripts/mcp-agent-config.ts --profile investigation-read --project <project-id> [--url http://127.0.0.1:8787]
```

prints an `mcpServers` entry (Claude Desktop / Claude Code / Cursor style):

```json
{
  "mcpServers": {
    "digital-kingdom-investigation-read": {
      "command": "<repo>/node_modules/.bin/tsx",
      "args": ["<repo>/apps/mcp/src/main.ts"],
      "env": {
        "DK_URL": "http://127.0.0.1:8787",
        "DK_PROJECT": "<project-id>",
        "DK_MCP_PROFILE": "investigation-read",
        "DK_TOKEN": "<project-scoped SERVICE token with role viewer>"
      }
    }
  }
}
```

Replace `DK_TOKEN` with a token an administrator created for that project only (`POST /api/tokens`,
`principal_type: "service"`). The test `apps/mcp/test/phase-lp11-focused.test.ts` launches the server exactly from the
generated entry. An agent that also has repository or shell access is a `development_assisted` run, not a blinded one
(see 04_AI_LOOP_AND_EVALUATION.md §3).
