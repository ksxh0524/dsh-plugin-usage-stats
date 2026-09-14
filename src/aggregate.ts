/** 聚合层：文件级增量缓存（mtime+size 键）+ 总计 / byModel / byDay / bySession 汇总。
 *  所有导出结构保持 JSON-safe，直接作为 Remote 返回值。 */
import { stat } from "node:fs/promises";
import { listSessionFiles, readFold, type Fold, type SessionMeta, type UsageFact } from "./scanner.ts";
import { costOf, priceFor, type Prices } from "./pricing.ts";

export interface FileCacheEntry {
  mtimeMs: number;
  size: number;
  fold: Fold;
}

export interface ScanResult {
  folds: Fold[];
  files: number;
  reloaded: number;
}

/** 扫描全部会话：命中缓存（mtime+size 未变）即复用折叠结果；每文件之间让出事件循环，避免首扫长时间占用宿主。 */
export async function scanFolds(root: string, cache: Map<string, FileCacheEntry>): Promise<ScanResult> {
  const files = await listSessionFiles(root);
  let reloaded = 0;
  const alive = new Set(files);
  for (const key of [...cache.keys()]) if (!alive.has(key)) cache.delete(key);
  for (const file of files) {
    let s;
    try {
      s = await stat(file);
    } catch {
      continue;
    }
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === s.mtimeMs && hit.size === s.size) continue;
    try {
      cache.set(file, { mtimeMs: s.mtimeMs, size: s.size, fold: await readFold(file) });
      reloaded++;
    } catch {
      cache.set(file, { mtimeMs: s.mtimeMs, size: s.size, fold: { facts: [], meta: null } });
    }
    await new Promise((r) => setImmediate(r));
  }
  const folds: Fold[] = [];
  for (const file of files) {
    const e = cache.get(file);
    if (e) folds.push(e.fold);
  }
  return { folds, files: files.length, reloaded };
}

export interface Range {
  from?: string;
  to?: string;
}

export function normalizeRange(raw: unknown): Range {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Range = {};
  const ok = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (ok(r.from)) out.from = String(r.from);
  if (ok(r.to)) out.to = String(r.to);
  if (out.from && out.to && out.from > out.to) {
    const t = out.from;
    out.from = out.to;
    out.to = t;
  }
  return out;
}

function inRange(date: string, range: Range): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function collectFacts(folds: Fold[], range: Range): { facts: UsageFact[]; metaById: Map<string, Fold["meta"]> } {
  const facts: UsageFact[] = [];
  const metaById = new Map<string, Fold["meta"]>();
  for (const fold of folds) {
    for (const f of fold.facts) {
      if (!inRange(f.date, range)) continue;
      facts.push(f);
      if (fold.meta && !metaById.has(f.sessionId)) metaById.set(f.sessionId, fold.meta);
    }
  }
  return { facts, metaById };
}

export interface Totals {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  /** 窗口内是否有任一 usage 样本上报过缓存字段（未上报 → 命中率无口径，显示“—”）。 */
  reportsCache: boolean;
}

export function emptyTotals(): Totals {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, reportsCache: false };
}

function add(t: Totals, f: UsageFact): void {
  t.requests += 1;
  t.input += f.input;
  t.output += f.output;
  t.cacheRead += f.cacheRead;
  t.cacheWrite += f.cacheWrite;
  t.total += f.input + f.output + f.cacheRead + f.cacheWrite;
  if (f.hasCache) t.reportsCache = true;
}

/** 命中率 = cacheRead / (cacheRead + 未缓存输入)；缓存字段未上报的口径返回 null（UI 显示“—”）。 */
export function hitRate(t: Totals): number | null {
  if (!t.reportsCache) return null;
  const denom = t.cacheRead + t.input;
  if (denom <= 0) return null;
  return t.cacheRead / denom;
}

export interface ModelRow extends Totals {
  provider: string;
  model: string;
  key: string;
  hitRate: number | null;
  cost: number | null;
}

export interface DayRow extends Totals {
  date: string;
  hitRate: number | null;
  cost: number | null;
}

export interface MessageCounts {
  user: number;
  assistant: number;
  toolCalls: number;
}

export interface Overview {
  totals: Totals;
  /** 会话级消息计数：窗口内有 usage 事实的会话的 meta 计数之和（按 meta 对象去重）。 */
  messages: MessageCounts;
  hitRate: number | null;
  cost: number | null;
  priced: boolean;
  /** 价目表配置的键数（卡底「N 个模型已配价」摘要用，与窗口无关）。 */
  configuredPrices: number;
  byModel: ModelRow[];
  byDay: DayRow[];
  sessionCount: number;
  scannedFiles: number;
  generatedAt: number;
}

export function buildOverview(folds: Fold[], range: Range, prices: Prices): Overview {
  const { facts, metaById } = collectFacts(folds, range);
  const totals = emptyTotals();
  const modelRows = new Map<string, ModelRow>();
  const dayRows = new Map<string, DayRow>();
  const pricedModels = new Set<string>();
  const dayCosts = new Map<string, number>();
  let costSum = 0;
  let anyPrice = false;
  for (const f of facts) {
    add(totals, f);
    const key = `${f.provider}/${f.model}`;
    const price = priceFor(prices, f.provider, f.model);
    if (price) {
      pricedModels.add(key);
      anyPrice = true;
    }
    let m = modelRows.get(key);
    if (!m) {
      m = { ...emptyTotals(), provider: f.provider, model: f.model, key, hitRate: null, cost: null };
      modelRows.set(key, m);
    }
    add(m, f);
    let d = dayRows.get(f.date);
    if (!d) {
      d = { ...emptyTotals(), date: f.date, hitRate: null, cost: null };
      dayRows.set(f.date, d);
    }
    add(d, f);
    const c = costOf({ input: f.input, output: f.output, cacheRead: f.cacheRead, cacheWrite: f.cacheWrite }, price);
    if (c !== null) {
      costSum += c;
      dayCosts.set(f.date, (dayCosts.get(f.date) || 0) + c);
    }
  }
  const byModel = [...modelRows.values()]
    .map((m) => ({ ...m, hitRate: hitRate(m), cost: costOf(m, priceFor(prices, m.provider, m.model)) }))
    .sort((a, b) => b.total - a.total);
  const byDay = [...dayRows.values()]
    .map((d) => ({ ...d, hitRate: hitRate(d), cost: dayCosts.get(d.date) ?? null }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  // 会话级计数：按 meta 对象去重后累加（同文件一会话；跨窗口有事实的会话才计）。
  const messages: MessageCounts = { user: 0, assistant: 0, toolCalls: 0 };
  for (const meta of new Set(metaById.values())) {
    if (!meta) continue;
    messages.user += meta.userMessages || 0;
    messages.assistant += meta.assistantMessages || 0;
    messages.toolCalls += meta.toolCalls || 0;
  }
  return {
    totals,
    messages,
    hitRate: hitRate(totals),
    cost: anyPrice ? costSum : null,
    priced: anyPrice,
    configuredPrices: Object.keys(prices).length,
    byModel,
    byDay,
    sessionCount: metaById.size || new Set(facts.map((f) => f.sessionId)).size,
    scannedFiles: folds.length,
    generatedAt: Date.now(),
  };
}

export interface SessionRow extends Totals {
  sessionId: string;
  title: string;
  cwd: string;
  subagent: boolean;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  models: string[];
  hitRate: number | null;
  cost: number | null;
  firstTime: number;
  lastTime: number;
}

export interface DrillResult {
  rows: SessionRow[];
  total: number;
}

export interface DrillQuery extends Range {
  /** 模型键 "provider/model"，缺省不限。 */
  model?: string;
  limit: number;
  offset: number;
}

export function normalizeDrill(raw: unknown): DrillQuery {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const q: DrillQuery = { ...normalizeRange(raw), limit: 20, offset: 0 };
  if (typeof r.model === "string" && r.model) q.model = r.model;
  const lim = Number(r.limit);
  if (Number.isFinite(lim) && lim > 0) q.limit = Math.min(Math.floor(lim), 200);
  const off = Number(r.offset);
  if (Number.isFinite(off) && off >= 0) q.offset = Math.floor(off);
  return q;
}

export function buildDrill(folds: Fold[], q: DrillQuery, prices: Prices): DrillResult {
  const rows = new Map<string, SessionRow>();
  const costById = new Map<string, number>();
  for (const fold of folds) {
    for (const f of fold.facts) {
      if (!inRange(f.date, q)) continue;
      if (q.model && `${f.provider}/${f.model}` !== q.model) continue;
      let row = rows.get(f.sessionId);
      if (!row) {
        const sameMeta = fold.meta && fold.meta.sessionId === f.sessionId ? fold.meta : null;
        row = {
          ...emptyTotals(),
          sessionId: f.sessionId,
          title: fold.meta?.title || "",
          cwd: fold.meta?.cwd || "",
          subagent: !!fold.meta?.subagent,
          userMessages: sameMeta?.userMessages || 0,
          assistantMessages: sameMeta?.assistantMessages || 0,
          toolCalls: sameMeta?.toolCalls || 0,
          models: [],
          hitRate: null,
          cost: null,
          firstTime: f.time,
          lastTime: f.time,
        };
        rows.set(f.sessionId, row);
        costById.set(f.sessionId, 0);
      }
      const key = `${f.provider}/${f.model}`;
      if (!row.models.includes(key)) row.models.push(key);
      add(row, f);
      if (f.time < row.firstTime) row.firstTime = f.time;
      if (f.time > row.lastTime) row.lastTime = f.time;
      const c = costOf({ input: f.input, output: f.output, cacheRead: f.cacheRead, cacheWrite: f.cacheWrite }, priceFor(prices, f.provider, f.model));
      if (c !== null) costById.set(f.sessionId, (costById.get(f.sessionId) || 0) + c);
    }
  }
  const all = [...rows.values()].map((r) => ({ ...r, hitRate: hitRate(r), cost: costById.get(r.sessionId) ?? null })).sort((a, b) => b.lastTime - a.lastTime);
  return { rows: all.slice(q.offset, q.offset + q.limit), total: all.length };
}

/* ---------------- v2：当前会话用量（面板数据源） ---------------- */

export interface SessionUsage {
  sessionId: string;
  cwd: string;
  title: string;
  subagent: boolean;
  createdAt: number;
  delegationDepth: number;
  messages: MessageCounts;
  /** 四路 token + requests（重试折叠后口径，与 overview 一致）。 */
  totals: Totals;
  hitRate: number | null;
  cost: number | null;
  priced: boolean;
  byModel: ModelRow[];
  firstTime: number;
  lastTime: number;
}

/** `sessionUsage(query)` 入参归一：只认字符串 sessionId，其余一律空串（聚合层回 null）。 */
export function normalizeSessionId(raw: unknown): string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return typeof r.sessionId === "string" ? r.sessionId : "";
}

/** 单会话聚合：meta 字段 + 全部 usage 事实（不筛日期）；会话未被扫到返回 null。 */
export function buildSessionUsage(folds: Fold[], sessionId: string, prices: Prices): SessionUsage | null {
  if (!sessionId) return null;
  let meta: SessionMeta | null = null;
  const totals = emptyTotals();
  const modelRows = new Map<string, ModelRow>();
  let costSum = 0;
  let anyPrice = false;
  let firstTime = 0;
  let lastTime = 0;
  let found = false;
  for (const fold of folds) {
    if (fold.meta && fold.meta.sessionId === sessionId) meta = fold.meta;
    for (const f of fold.facts) {
      if (f.sessionId !== sessionId) continue;
      found = true;
      add(totals, f);
      const key = `${f.provider}/${f.model}`;
      const price = priceFor(prices, f.provider, f.model);
      if (price) anyPrice = true;
      let m = modelRows.get(key);
      if (!m) {
        m = { ...emptyTotals(), provider: f.provider, model: f.model, key, hitRate: null, cost: null };
        modelRows.set(key, m);
      }
      add(m, f);
      const c = costOf({ input: f.input, output: f.output, cacheRead: f.cacheRead, cacheWrite: f.cacheWrite }, price);
      if (c !== null) costSum += c;
      if (!firstTime || f.time < firstTime) firstTime = f.time;
      if (f.time > lastTime) lastTime = f.time;
    }
  }
  if (!meta && !found) return null; // 文件未落盘/未扫到/坏 id：客户端显示「未采集到该会话用量」
  const byModel = [...modelRows.values()]
    .map((m) => ({ ...m, hitRate: hitRate(m), cost: costOf(m, priceFor(prices, m.provider, m.model)) }))
    .sort((a, b) => b.total - a.total);
  return {
    sessionId,
    cwd: meta?.cwd || "",
    title: meta?.title || "",
    subagent: !!meta?.subagent,
    createdAt: meta?.createdAt || 0,
    delegationDepth: meta?.delegationDepth || 0,
    messages: {
      user: meta?.userMessages || 0,
      assistant: meta?.assistantMessages || 0,
      toolCalls: meta?.toolCalls || 0,
    },
    totals,
    hitRate: hitRate(totals),
    cost: anyPrice ? costSum : null,
    priced: anyPrice,
    byModel,
    firstTime: firstTime || meta?.createdAt || 0,
    lastTime,
  };
}
