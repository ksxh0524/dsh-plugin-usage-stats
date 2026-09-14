# dsh-plugin-usage-stats

[中文版文档见 README.zh.md](./README.zh.md)

A usage-statistics plugin for the DSH (DeepSeek Harness) Web GUI (v2): the **right-sidebar "Usage" tab is a current-session view** (message counts, four token streams, cache hit rate, per-model breakdown, cost), while a **global report card lives in Settings → Plugins → plugin configuration** (session-independent; filter by today / 7 days / 30 days / all / a single day). Strictly read-only, zero instrumentation.

- Data source: `<DSH_HOME>/sessions/*/*/session.v3.jsonl.zstd` — a **global view across all workspaces**, with subagent-session flagging.
- Shape: the server side registers a `usageStats` Typert Remote (three read-only methods: `overview` / `drillSessions` / `sessionUsage`) plus the `usage-stats` settings namespace (price-table persistence); the browser half is a hand-written `__ModuleLoader__` factory (`lib/client.js`, no build chain). The panel's current-session id comes from the session-scoped standard `sessionId` prop of the `sidebar.right.pane.tab` slot (the same source the official sidebar-files tab uses), so switching sessions reloads the panel automatically.

## Install

```sh
dsh plugin --profile <your-profile> add dsh-plugin-usage-stats
```

Then **restart that profile's host** (newly mounted packages are not hot-loaded). Reload the Web GUI → right sidebar guide page → the "Usage" pill → opens as a tab.

- **Panel (current session)**: session title / short id / cwd / subagent badge, then user messages / agent messages / tool calls / request steps, then total input (uncached) / output / cache read (with hit rate) / cache write, a per-model table, and cost (amount when prices exist, otherwise "—"), plus a Refresh button (rescans session files; a brand-new session not yet on disk shows "usage not captured for this session").
- **Settings card (global report)**: range chips (today / 7 days / 30 days / all) plus a single-day picker (local time zone), a KPI grid (sessions, messages, four token streams, hit rate, total cost), a per-model table, and a read-only price summary at the bottom (editing goes through settings.yaml, see below). Deliberately lightweight — no price-editing form.

## Metrics

- `inputTokens` = **uncached input** (`total = input + output + cacheRead + cacheWrite`, verified against real data).
- Hit rate = `cacheRead / (cacheRead + uncached input)`; `cacheWrite` is reported separately and excluded from the ratio.
- Providers that never report cache fields show the hit rate as "—" (never a misleading 0%).
- Retry folding: within one `(session, turn, step)` scope only the last usage sample survives.
- Cost: models without a configured price report tokens only, never money.
- Message counts (v2): `userMessages` counts `user/message` lines, `assistantMessages` counts `assistant/message` lines (including usage-less ones), `toolCalls` counts `tool/call` lines — counted inline at O(1), no dedup. On the global card, messages are summed over the meta of sessions that have usage facts inside the window (deduped by meta object), the same population as the session count.
- `sessionUsage` aggregates all usage facts of one session (no date filtering); when the session has not been scanned it returns `null` (the panel shows "usage not captured", usually because a brand-new session has not hit disk yet).

## Price table (CNY / million tokens)

Two layers following host settings semantics: **patch base (deployment default) → user settings layer overrides it** — hot-applied, no restart.

1. **User layer (recommended)**: the `usage-stats` namespace persisted in `~/.dsh/settings.yaml` (openable from the host's Settings page):

   ```yaml
   usage-stats:
     prices:
       "opencode-go/glm-5.3-flash": { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 }
       "some-lora-model": { input: 1 } # missing fields default to 0
   ```

2. **Deployment base**: the profile patch line's `config.prices` (the default written by `dsh plugin`).
   Note: a patch line **replaces the target row's config wholesale** — restate every key when writing one:

   ```yaml
   - id: usage-stats
     config:
       sessionsHome: "" # empty = $DSH_HOME/sessions
       prices: {}
   ```

Keys accept `"provider/model"` (exact match first) or a bare `"model"` (fallback). Values must be ≥ 0 (the schema rejects negatives).

## Development

When mounted into a host profile via pnpm `link:` (a symlink), source edits need **no reinstall**: server-side changes apply after a host restart, `lib/client.js` changes apply on page reload. With `file:` mounting you must run `pnpm install` inside the profile to resync the copy each time.

The `@deepseek-ai/schemastery` dependency (settings schema) shares the host's top-level copy under a pnpm hoisted layout — no cross-copy instanceof risk.

## Tests

```sh
node --test tests/*.test.ts
```

Fixture metric tests (folding, message counts, per-session aggregation, price folding, settings wiring) plus integration tests against the real session directory (auto-skipped when none exists).

## Known limits (v0.2)

- Session files are appended multi-frame zstd streams: decoding uses the `zstd -dc` CLI (falling back to node:zlib single-frame decoding when the CLI is absent, which may miss later frames).
- File-level caching keys on `mtime+size`; a changed file is fully re-decoded — there are no byte-level tail increments.
- Panel/card fetch on open, on manual refresh, and on session/range changes; there is no server push.
- The browser side `$mount`s hand-written strict descriptors (result schema is passthrough); method/parameter names (`overview(filter)` / `drillSessions(query)` / `sessionUsage(query)`) are an implicit contract shared with `src/cordis.ts` — renaming on one end must be synced to the other.
- The settings card is read-only: it shows the global report plus an "N models priced" summary; price editing still happens in the settings.yaml document (the data layer and hot reload are ready; an editing form is intentionally out of scope).
