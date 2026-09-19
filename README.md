# dsh-plugin-usage-stats

[中文](./README.zh.md)

Usage-statistics plugin for the DSH Web GUI: a dedicated **Token 用量 page in Settings** — a global, session-independent report across all workspaces, with date-range picker, model/provider filters, a KPI grid and one per-model table. The usage surface is strictly read-only with zero instrumentation (the only write point is the two combined-total switches on the plugin card). Per-session stats stay in the host chat UI; the one number the host cannot show — the session plus all descendant subagent sessions — arrives as a **combined-total pill under the composer**.

## Tools & Services

| Name             | Kind    | Shape                                                                                                                                                                                      |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `usageStats`     | Remote  | `overview(filter)` global rollup, `familyTotal({sessionId})` combined-total rollup, `getConfig`/`setConfig` combined-total switches — all read-only except the config write (see Contract) |
| fold scanner     | Service | Byte-accurate zstd frame walker: only newly completed frames are decompressed; state in `<DSH_HOME>/cache/usage-stats.folds.json`                                                          |
| tombstone ledger | Service | Deleted sessions keep their scanned facts as tombstones (live file reappearing wins; no double counting)                                                                                   |

## Contract

| Item          | Rule                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview`    | `{from?, to?, model?, provider?}` — dates are `YYYY-MM-DD` (local zone, inverted pairs swapped); invalid keys are dropped, never guessed                                                                                                                                                                                                                  |
| `familyTotal` | `{sessionId}` → `{enabled, dockVisible, known, isSubagent, sessionCount, totals, hitRate, byModel}`; unknown ids return `known: false`, subagent sessions `isSubagent: true`; counts only, no per-session breakdown                                                                                                                                       |
| `getConfig`   | `{}` → `{config: {familyEnabled, dockVisible}, settingsSection: "usage-stats", writable}` — the two combined-total switches plus host write permission                                                                                                                                                                                                    |
| `setConfig`   | `{familyEnabled?, dockVisible?}` → merged config (persisted to `~/.dsh/settings.yaml` with hot push; throws on invalid patch or absent settings face)                                                                                                                                                                                                     |
| Metrics       | `inputTokens` = uncached input (`total = input + output + cacheRead + cacheWrite`); hit rate = `cacheRead / (cacheRead + uncached input)`; retry folding keeps the last sample per `(session, turn, step)`; compact display (K/M/B tiers) rounds each figure independently — hover any number for the exact count (parts always sum to the total exactly) |
| Money         | Out of product: the report is pure token statistics (the price layer was retired in v4); the footer is just a data-freshness timestamp                                                                                                                                                                                                                    |

## Config

| key            | Description                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionsHome` | Session root override; empty = default (`$DSH_HOME/sessions` or `~/.dsh/sessions`). Set it from the profile patch layer to point at another session root. |

## Install

```sh
# profile package.json dependencies (local checkout until the first npm release):
"dsh-plugin-usage-stats": "link:../plugin-usage-stats"
```

Bundle row: package `dsh-plugin-usage-stats` + patch insert id `usage-stats` (`sessionsHome: ""` = default root). Then restart that profile's host (newly mounted packages are not hot-loaded) and reload the Web GUI → Settings → left nav → **Token 用量**. Host restart is user-owned.

## Verify

```sh
node --test tests/*.test.ts   # server logic first
pnpm check                     # prettier + tsc + full tests
pnpm check:browser             # browser-half changes only
```

## Browser half

`lib/client.js` (`./client` subpath, hand-written `__ModuleLoader__` factory, no build chain): the settings section page plus the composer pill. Host-conformant shape, not pixels (index `docs/settings-pages.md` §1, `docs/design-tokens.md` §1, `docs/runbooks/live-verify.md`).

| Seat claim & yield | Status                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claimed seats      | `settings.section` page (Token 用量, order 30) + `conversation.composer.dock` pill (id `family-total`, order 1) + `plugins.item` config card (id `usage-stats`, order 110) |
| Yield plan         | The pill renders only on main sessions with billed activity (hidden on subagent / unknown / empty sessions); the page is dedicated, no contention                          |

The combined-total card lives on the Plugins page (next to the official cards): `familyEnabled` master switch (off hides the Settings "Token 用量" page and the composer pill together) and `dockVisible` (hides only the pill under the composer). Toggle-to-save, persisted hot to settings; both default on. Card and in-page groups are always expanded (no folding).

## Interaction contract (user-confirmed, deviates from host defaults)

- Plugin card (`plugins.item`): content always expanded — no collapse header, chevron, or `aria-expanded`. Toggling either switch writes immediately via `setConfig` (no draft / save / discard — both switches are reversible booleans, two rows only). A failed write rolls back to the confirmed value with an inline error + retry.
- Master switch drives the tab: turning `familyEnabled` off unregisters the `settings.section` page, so the Settings left-nav entry disappears with it; turning it back on restores the page. Unreadable config fails open (the page stays).
- Same rule inside the page: model/detail groups are static sections (`<h3>` + count subline), never collapsible.
- The combined-total pill refreshes itself: subagent open/close, settled steps in the current session, and a 3s server-side poll (the only channel for tokens accrued inside subagent sessions) — the pill appears on its own and its numbers follow without a manual page refresh. Polling rides the incremental scan (unchanged files are only stat-checked) and pauses while the tab is hidden.

## Known limits

- Incremental decoding relies on recognizing completed frames; a half-written tail frame folds on the next run, and legacy/dict frames degrade to full-file rescans (still correct, just slower).
- Settings page: fetch on open and on manual refresh / filter change; there is no server push and no automatic polling (the combined-total pill's self-refresh is described above).
- The browser side `$mount`s a hand-written strict descriptor; method/parameter names are an implicit contract shared with `src/cordis.ts` — renaming on one end must sync the other.
- Providers that never report cache fields show the hit rate as "—", never a misleading 0%.
