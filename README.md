# dsh-plugin-usage-stats

[中文](./README.zh.md)

A usage-statistics plugin for the DSH (DeepSeek Harness) Web GUI: a **dedicated "Token 用量" page in Settings** — a global, session-independent report across all workspaces, with a date-range picker (defaults to today; presets 今天 / 近3天 / 近7天 / 近30天; footer "清除" = all time), **model and provider filters**, a KPI grid and one per-model table. Strictly read-only, zero instrumentation.

The page follows the host's own section-page grammar (index `docs/settings-pages.md` §4.4): scrolling stays with the host shell (the page root owns no `overflow`/`height`/root padding), width sits on the host tier (760px), a real `<h2>` heads the page while detail tables live in foldable in-page groups, the three read states are wired (`aria-busy`, `role="alert"` + retry, an empty-state line), facts are read out as `<dl>/<dt>/<dd>`, and the filter dropdown is the host `Menu` primitive (portal + outside-pointer + Escape + arrow keys) rather than a hand-rolled popover with a full-screen mask. The date calendar is the one thing the host has no component for: it stays self-drawn but sits on the host's anchoring/dismiss hooks, and its day cells are real buttons.

Per-session stats (turns/steps, tok/s, cache hit, per-message usage) are **built into the host chat UI** — this plugin deliberately does not duplicate them; v2's sidebar tab and drill-down endpoints were removed for that reason.

- Data source: `<DSH_HOME>/sessions/*/*/session.v3.jsonl.zstd` — a **global view across all workspaces**, including subagent sessions.
- Incremental by design: session files are appended multi-frame zstd streams. A byte-accurate zstd frame walker (RFC 8878 headers, no LZ4 decoding) lets the scanner persist fold state per file and, on later runs, decompress **only newly completed frames**; unchanged files cost zero I/O. Persistent state lives in `<DSH_HOME>/cache/usage-stats.folds.json` (atomic tmp+rename; corrupt or missing state falls back to a full rescan).
- Retention ledger: deleting a session file no longer deletes its history — already-scanned facts are promoted to a per-session tombstone (the `tombs` section of the same cache file) and stay in the totals; if a live file with the same session reappears, live data wins and the tombstone steps aside (no double counting). The only reset is deleting the cache file.
- Shape: the server side registers a `usageStats` Typert Remote with a **single read-only method `overview(filter)`**; the browser half is a hand-written `__ModuleLoader__` factory (`lib/client.js`, no build chain) that self-mounts its remote descriptor and injects a `settings.section` entry.

## Install

```sh
dsh plugin --profile <your-profile> add dsh-plugin-usage-stats
```

Then **restart that profile's host** (newly mounted packages are not hot-loaded). Reload the Web GUI → Settings → **left nav rail, the entry next to General / Models / Plugins / Agent presets** → **Token 用量**.

- **Date range**: one trigger button (never two native inputs) opening a popover: preset chips + a two-click month-range calendar (local time zone, day granularity). Selection speaks a neutral single-color language (no brand blue): solid pill endpoints, a same-hue lighter band in between that darkens under the cursor so hover always shows where you are, a subtle ring on today; day cells flex-center large 18px numerals. The footer "清除" (the only reset entry) falls back to all time.
- **Filters**: provider and model dropdowns (options derived from the last unfiltered scan; picking a provider narrows the model list).
- **Report**: sessions scanned, total tokens, uncached input / output / cache read (with hit rate) / cache write, then a single per-model table — deliberately **no per-day table**: the date-range filter already answers "what about this day" (set the range to that day). Deliberately lightweight: the report is pure token statistics — money left the product in v4 (the whole price/pricing layer was retired, API included); the footer is just a data-freshness timestamp. Number tiers: exact under 1K, then `K` (≥1K, one decimal), `M` (≥1M, two decimals), `B` (≥100M, two decimals) — trailing zeros trimmed.

## Config

| key            | Description                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionsHome` | Session root override; empty = default (`$DSH_HOME/sessions` or `~/.dsh/sessions`). Set it from the profile patch layer to point at another session root. |

## Tools

- `usageStats` Typert Remote with a single read-only method `overview({ from?, to?, model?, provider? })` — dates are `YYYY-MM-DD` (local zone, inverted pairs swapped); invalid keys are dropped, never guessed.
- The browser half is a hand-written `__ModuleLoader__` factory (`lib/client.js`, no build chain) that self-mounts its remote descriptor and injects the `settings.section` page.

## Metrics

- `inputTokens` = **uncached input** (`total = input + output + cacheRead + cacheWrite`, verified against real data).
- Hit rate = `cacheRead / (cacheRead + uncached input)`; `cacheWrite` is reported separately and excluded from the ratio.
- Providers that never report cache fields show the hit rate as "—" (never a misleading 0%).
- Retry folding: within one `(session, turn, step)` scope only the last usage sample survives — which also makes incremental replay idempotent.
- Session profile: the scanner still parses `userMessages` / `assistantMessages` / `toolCalls` into `SessionMeta` (cheap inline counting), but the overview no longer aggregates them — the UI shows no message row.
- `overview(filter)` accepts `{ from?, to?, model?, provider? }` — dates are `YYYY-MM-DD` (local zone, inverted pairs are swapped), `model` matches the `"provider/model"` key exactly or a bare model name as fallback, `provider` matches the provider segment. Invalid keys are dropped, never guessed.

## Development

When mounted into a host profile via pnpm `link:` (a symlink), source edits need **no reinstall**: server-side changes apply after a host restart, `lib/client.js` changes apply on page reload. With `file:` mounting you must run `pnpm install` inside the profile to resync the copy each time.

## Tests

```sh
node --test tests/*.test.ts
```

Fixture metric tests (folding, retry replacement, filters, session-profile counts, store version gate), byte-accurate frame-walker tests against real `zstd` CLI output (skipped without the CLI), an incremental-equals-full-replay property test with lines deliberately split across frame boundaries, a persistent-store restart test, plus integration tests against the real session directory (auto-skipped when none exists). `tests/picker.test.ts` renders the browser half in a synchronous mini-React harness (stubbing react / react-dom / the host primitives) to keep the calendar's per-cell bindings honest and to assert the page still passes the workspace's index `docs/settings-pages.md` §4.4 structure and index `docs/design-tokens.md` §4.3 motion gates.

## Known limits (v0.4)

- Incremental decoding relies on the frame walk recognizing completed frames; a half-written tail frame is folded on the next run, and legacy/dict frames degrade to full-file rescans (still correct, just slower).
- Without the `zstd` CLI the incremental path decodes frame-by-frame via node:zlib; if that fails too, the whole-store fallback is a correct full rescan.
- Fetch on open and on manual refresh / filter change; there is no server push, and no automatic polling.
- The browser side `$mount`s a hand-written strict descriptor (result schema is passthrough); the method/parameter names (`overview(filter)`) are an implicit contract shared with `src/cordis.ts` — renaming on one end must be synced to the other.

## Browser E2E (UI verification)

`pnpm check:browser` boots a disposable instance and drives headless Chrome into the
"Token 用量" section page, asserting the host-conformant shape rather than pixels: the
root owns no scroller and no root padding, the page has an `<h2>`, in-page groups fold
for real (`aria-expanded` + `aria-controls`, content removed from the DOM), KPIs are
`<dl>/<dt>/<dd>` and tables carry `caption`/`th[scope]`, the filter dropdown escapes the
page container through a portal with `role=menu`/`role=menuitem` keyboard navigation and
no self-made mask (host chrome stays one-click reachable while it is open), and the
calendar's day cells are real buttons with future days natively `disabled`.
Browser-half changes must pass it (index `docs/settings-pages.md` §4.4 + index `docs/runbooks/live-verify.md`, dsh-check gate 12).
