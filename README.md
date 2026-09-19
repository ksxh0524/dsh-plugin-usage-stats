# dsh-plugin-usage-stats

[中文](./README.zh.md)

Usage-statistics plugin for the DSH Web GUI: a dedicated **Token 用量 page in Settings** — a global, session-independent report across all workspaces, with date-range picker, model/provider filters, a KPI grid and one per-model table. Strictly read-only, zero instrumentation. Per-session stats stay in the host chat UI; the one number the host cannot show — the session plus all descendant subagent sessions — arrives as a **combined-total pill under the composer**.

## Tools & Services

| Name             | Kind    | Shape                                                                                                                             |
| ---------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `usageStats`     | Remote  | `overview(filter)` global rollup and `familyTotal({sessionId})` combined-total rollup — both read-only (see Contract)             |
| fold scanner     | Service | Byte-accurate zstd frame walker: only newly completed frames are decompressed; state in `<DSH_HOME>/cache/usage-stats.folds.json` |
| tombstone ledger | Service | Deleted sessions keep their scanned facts as tombstones (live file reappearing wins; no double counting)                          |

## Contract

| Item          | Rule                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview`    | `{from?, to?, model?, provider?}` — dates are `YYYY-MM-DD` (local zone, inverted pairs swapped); invalid keys are dropped, never guessed                                                                                                                                                                                                                  |
| `familyTotal` | `{sessionId}` → `{known, isSubagent, sessionCount, totals, hitRate, byModel}`; unknown ids return `known: false`, subagent sessions `isSubagent: true`; counts only, no per-session breakdown                                                                                                                                                             |
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

| Seat claim & yield | Status                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claimed seats      | `settings.section` page (Token 用量, order 30) + `conversation.composer.dock` pill (id `family-total`, order 1)                                   |
| Yield plan         | The pill renders only on main sessions with billed activity (hidden on subagent / unknown / empty sessions); the page is dedicated, no contention |

Pill visibility is a browser-side localStorage preference (default on), not a server config.

## Known limits

- Incremental decoding relies on recognizing completed frames; a half-written tail frame folds on the next run, and legacy/dict frames degrade to full-file rescans (still correct, just slower).
- Fetch on open and on manual refresh / filter change; there is no server push and no automatic polling.
- The browser side `$mount`s a hand-written strict descriptor; method/parameter names are an implicit contract shared with `src/cordis.ts` — renaming on one end must sync the other.
- Providers that never report cache fields show the hit rate as "—", never a misleading 0%.
