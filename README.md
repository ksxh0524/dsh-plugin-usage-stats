# dsh-plugin-usage-stats

[中文](./README.zh.md)

A usage-statistics plugin for the DSH (DeepSeek Harness) Web GUI (v3): a **dedicated "Token 用量" page in Settings** — a global, session-independent report across all workspaces, with a date-range picker (defaults to today; presets 今天 / 近3天 / 近7天 / 近30天 / 全部), **model and provider filters**, KPI grid, per-model and per-day tables, and optional cost. Strictly read-only, zero instrumentation.

Per-session stats (turns/steps, tok/s, cache hit, per-message usage) are **built into the host chat UI** — this plugin deliberately does not duplicate them; v2's sidebar tab and drill-down endpoints were removed for that reason.

- Data source: `<DSH_HOME>/sessions/*/*/session.v3.jsonl.zstd` — a **global view across all workspaces**, including subagent sessions.
- Incremental by design: session files are appended multi-frame zstd streams. A byte-accurate zstd frame walker (RFC 8878 headers, no LZ4 decoding) lets the scanner persist fold state per file and, on later runs, decompress **only newly completed frames**; unchanged files cost zero I/O. Persistent state lives in `<DSH_HOME>/cache/usage-stats.folds.json` (atomic tmp+rename; corrupt or missing state falls back to a full rescan).
- Shape: the server side registers a `usageStats` Typert Remote with a **single read-only method `overview(filter)`** plus the `usage-stats` settings namespace (price-table persistence); the browser half is a hand-written `__ModuleLoader__` factory (`lib/client.js`, no build chain) that self-mounts its remote descriptor and injects a `settings.section` entry.

## Install

```sh
dsh plugin --profile <your-profile> add dsh-plugin-usage-stats
```

Then **restart that profile's host** (newly mounted packages are not hot-loaded). Reload the Web GUI → Settings → General sidebar → **Token 用量**.

- **Date range**: one trigger button (never two native inputs) opening a popover: preset chips + a month calendar for arbitrary ranges (local time zone, day granularity). "全部" clears the window.
- **Filters**: provider and model dropdowns (options derived from the last unfiltered scan; picking a provider narrows the model list). Under a dimension filter the message-count KPI is hidden — message lines carry no model attribution, so there is no honest number to show.
- **Report**: sessions scanned, total tokens, uncached input / output / cache read (with hit rate) / cache write, then a per-model table and a per-day table (the per-day one carries a cost column when prices are configured), and a read-only price summary at the bottom (editing goes through settings.yaml, see below). Deliberately lightweight — no price-editing form.

## Metrics

- `inputTokens` = **uncached input** (`total = input + output + cacheRead + cacheWrite`, verified against real data).
- Hit rate = `cacheRead / (cacheRead + uncached input)`; `cacheWrite` is reported separately and excluded from the ratio.
- Providers that never report cache fields show the hit rate as "—" (never a misleading 0%).
- Retry folding: within one `(session, turn, step)` scope only the last usage sample survives — which also makes incremental replay idempotent.
- Cost: models without a configured price report tokens only, never money.
- Message counts: `userMessages` counts `user/message` lines, `assistantMessages` counts `assistant/message` lines (including usage-less ones), `toolCalls` counts `tool/call` lines — counted inline at O(1), no dedup. The overview sums counts over sessions that have usage facts inside the window (deduped per file); with a model/provider filter it returns `null`.
- `overview(filter)` accepts `{ from?, to?, model?, provider? }` — dates are `YYYY-MM-DD` (local zone, inverted pairs are swapped), `model` matches the `"provider/model"` key exactly or a bare model name as fallback (same rules as the price table), `provider` matches the provider segment. Invalid keys are dropped, never guessed.

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

Fixture metric tests (folding, message counts, filters, price folding, settings wiring), byte-accurate frame-walker tests against real `zstd` CLI output (skipped without the CLI), an incremental-equals-full-replay property test with lines deliberately split across frame boundaries, a persistent-store restart test, plus integration tests against the real session directory (auto-skipped when none exists).

## Known limits (v0.3)

- Incremental decoding relies on the frame walk recognizing completed frames; a half-written tail frame is folded on the next run, and legacy/dict frames degrade to full-file rescans (still correct, just slower).
- Without the `zstd` CLI the incremental path decodes frame-by-frame via node:zlib; if that fails too, the whole-store fallback is a correct full rescan.
- Fetch on open and on manual refresh / filter change; there is no server push, and no automatic polling.
- The browser side `$mount`s a hand-written strict descriptor (result schema is passthrough); the method/parameter names (`overview(filter)`) are an implicit contract shared with `src/cordis.ts` — renaming on one end must be synced to the other.
- Price editing stays in the settings.yaml document (the data layer and hot reload are ready; an editing form is intentionally out of scope).
