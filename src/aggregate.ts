/** 聚合层：增量扫描调度（状态经 store.ts 持久化）+ 全局总计（四路 token / 命中率 / byModel），
 *  overview 支持 model/provider 过滤（fact 层先过滤再聚合，与时间过滤同构）。
 *  所有导出结构保持 JSON-safe，直接作为 Remote 返回值。宿主自带会话统计（轮/步/tok·s/缓存），
 *  本包只做全局视角；v4 起 UI 不再展示消息数/按天/费用，对应 API 字段同步移除（不留死契约）。
 *  删除保留：总览输入 = 活文件 folds + 墓碑 folds（已删会话的最后已知用量）；scannedFiles
 *  只计活文件，sessionCount/totals 含墓碑——删会话不再让历史用量凭空消失。 */
import { stat } from "node:fs/promises";
import { listSessionFiles, type Fold, type UsageFact } from "./scanner.ts";
import { FoldStore } from "./store.ts";

export interface ScanResult {
  folds: Fold[];
  /** 已删会话的墓碑 folds（总览口径含它们；scannedFiles 不含）。 */
  tombs: Fold[];
  files: number;
  reloaded: number;
}

/** 扫描全部会话：未变文件复用持久行（0 解压），追加文件只解新增帧，其余整文件重解；
 *  每文件之间让出事件循环，避免首扫长时间占用宿主。 */
export async function scanFolds(root: string, store: FoldStore): Promise<ScanResult> {
  await store.load();
  const files = await listSessionFiles(root);
  let reloaded = 0;
  const folds: Fold[] = [];
  const alive = new Set<string>();
  for (const file of files) {
    let s;
    try {
      s = await stat(file);
    } catch {
      continue;
    }
    alive.add(file);
    const before = store.rows.get(file);
    try {
      folds.push(await store.foldFor(file, { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino }));
    } catch {
      folds.push({ facts: [], meta: null });
    }
    const after = store.rows.get(file);
    if (after && (!before || before.size !== after.size || before.bytes !== after.bytes)) reloaded++;
    await new Promise((r) => setImmediate(r));
  }
  await store.flush(alive);
  return { folds, tombs: store.tombFolds(), files: files.length, reloaded };
}

export interface Range {
  from?: string;
  to?: string;
  /** 精确模型匹配（"provider/model" 全键或裸 model 键）。 */
  model?: string;
  /** 服务商前缀匹配（"provider/" 之前的字段）。 */
  provider?: string;
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
  if (typeof r.model === "string" && r.model.trim()) out.model = r.model.trim();
  if (typeof r.provider === "string" && r.provider.trim()) out.provider = r.provider.trim();
  return out;
}

function inRange(date: string, range: Range): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

/** 模型/服务商过滤在 fact 层生效（全键 "prov/model" 精确，裸 model 兜底；provider 全等段匹配）。 */
function matchesDims(f: UsageFact, range: Range): boolean {
  if (range.provider && f.provider !== range.provider) return false;
  if (range.model && f.model !== range.model && `${f.provider}/${f.model}` !== range.model) return false;
  return true;
}

function collectFacts(folds: Fold[], range: Range): { facts: UsageFact[]; metaById: Map<string, Fold["meta"]> } {
  const facts: UsageFact[] = [];
  const metaById = new Map<string, Fold["meta"]>();
  const noDim = !range.model && !range.provider;
  for (const fold of folds) {
    for (const f of fold.facts) {
      if (!inRange(f.date, range)) continue;
      if (noDim) {
        facts.push(f);
        if (fold.meta && !metaById.has(f.sessionId)) metaById.set(f.sessionId, fold.meta);
      } else if (matchesDims(f, range)) {
        facts.push(f);
        // 维度过滤后，消息计数只统计「命中维度」的会话（否则口径与过滤后 totals 不一致）。
        if (fold.meta && !metaById.has(f.sessionId)) metaById.set(f.sessionId, null);
      }
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
}

export interface Overview {
  totals: Totals;
  hitRate: number | null;
  byModel: ModelRow[];
  sessionCount: number;
  scannedFiles: number;
  generatedAt: number;
}

export function buildOverview(folds: Fold[], range: Range, tombs: Fold[] = []): Overview {
  const { facts, metaById } = collectFacts(tombs.length ? folds.concat(tombs) : folds, range);
  const totals = emptyTotals();
  const modelRows = new Map<string, ModelRow>();
  for (const f of facts) {
    add(totals, f);
    const key = `${f.provider}/${f.model}`;
    let m = modelRows.get(key);
    if (!m) {
      m = { ...emptyTotals(), provider: f.provider, model: f.model, key, hitRate: null };
      modelRows.set(key, m);
    }
    add(m, f);
  }
  const byModel = [...modelRows.values()].map((m) => ({ ...m, hitRate: hitRate(m) })).sort((a, b) => b.total - a.total);
  return {
    totals,
    hitRate: hitRate(totals),
    byModel,
    sessionCount: metaById.size || new Set(facts.map((f) => f.sessionId)).size,
    scannedFiles: folds.length, // 只计活文件；墓碑会话计入 sessionCount/totals，不计入此数
    generatedAt: Date.now(),
  };
}
