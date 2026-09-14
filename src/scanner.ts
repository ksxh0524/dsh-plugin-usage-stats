/** 会话用量扫描（纯函数核心，零第三方依赖）：
 *  读 `<DSH_HOME>/sessions/<workspace-slug>/<session-dir>/session.v3.jsonl.zstd`，
 *  zstd 解压后逐行折叠成 UsageFact[]。
 *
 *  折叠规则（与设计文档一致）：
 *  - 当前模型 = 最近一条 request/header 的 data.header.config.{provider,model}；缺 header 归 unknown。
 *  - 每条 assistant/message.data.usage 归入 scope `<sessionId>:<turn>:<step>`（turn/step 由最近
 *    turn/start / step/start 记录维护）；同 scope 出现新样本即替换旧样本 = 重试取末条（与 token-meter 同规则）。
 *  - inputTokens 为「未缓存输入」（total = input + output + cacheRead [+ cacheWrite] 已在真实数据核实）。
 *  - session 行补 cwd/createdAt/delegationDepth/origin；session/title 行补标题。
 *
 *  增量解码（会话文件是追加式多帧 zstd，每次全量重解是浪费）：
 *  - `frameSpans` 按 RFC 8878 解析帧头与块头（块体按 24bit Block_Size 直接跳过，不碰 LZ4），
 *    得到完整帧的字节区间；文件尾半帧不算数（下次追加补齐再吃），legacy 帧/坏帧即停。
 *  - `foldChunk` 把一段解压文本喂进可续跑的 FoldState（游标/计数/facts 按 scope 去重 + 残行 tail），
 *    增量重放与全量重放逐字节等价（scope last-wins 天然幂等，计数只增）。
 *  - 持久化与失效判定在 store.ts / aggregate.ts；本文件只保证纯函数 + 解码边界正确。
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { zstdDecompressSync } from "node:zlib";

const execFileAsync = promisify(execFile);

/** 多帧 zstd 全量解码：首选 `zstd -dc`；node:zlib 兜底仅在无 CLI 时启用（它只解首帧，多帧文件会静默丢数据）。 */
async function decompressZstd(path: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("zstd", ["-dc", path], { maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const buf = await readFile(path);
    return zstdDecompressSync(buf).toString("utf8");
  }
}

export interface UsageFact {
  /** `<sessionId>:<turn>:<step>`，同 scope 只保留末条样本。 */
  scope: string;
  sessionId: string;
  provider: string;
  model: string;
  /** YYYY-MM-DD（本地时区，按记录 time）。 */
  date: string;
  /** 记录时间（ms epoch）。 */
  time: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** usage 对象是否上报过任一缓存字段（未上报的 provider 命中率应显示“—”而非 0%）。 */
  hasCache: boolean;
}

export interface SessionMeta {
  sessionId: string;
  cwd: string;
  title: string;
  createdAt: number;
  delegationDepth: number;
  /** 子代理会话（origin/parentSession/delegationDepth>0 任一命中）。 */
  subagent: boolean;
  /** 会话级计数（逐行顺带 O(1)，不做去重）：user/message 行数。 */
  userMessages: number;
  /** assistant/message 行数（无 usage 样本的也计）。 */
  assistantMessages: number;
  /** tool/call 行数。 */
  toolCalls: number;
}

export interface Fold {
  facts: UsageFact[];
  meta: SessionMeta | null;
}

/** 可续跑的折叠状态：游标（模型归因/turn/step）+ 单调计数 + scope 去重的 facts + 半行 tail。
 *  持久化时 scopeIndex 不写盘（恢复时从 facts 重建）。 */
export interface FoldState {
  meta: SessionMeta | null;
  provider: string;
  model: string;
  curTurn: number;
  curStep: number;
  facts: UsageFact[];
  scopeIndex: Map<string, number>;
  /** 上一段末尾未完成的 JSONL 行（追加式写入可能把一行拆进两帧），下一段拼回头部。 */
  tail: string;
  /** 会话 id 兜底（文件路径的上级目录名）。 */
  sessionIdHint: string;
}

export function newFoldState(sessionIdHint: string): FoldState {
  return {
    meta: null,
    provider: "unknown",
    model: "unknown",
    curTurn: -1,
    curStep: -1,
    facts: [],
    scopeIndex: new Map(),
    tail: "",
    sessionIdHint,
  };
}

export function foldSnapshot(s: FoldState): Fold {
  return { facts: s.facts, meta: s.meta };
}

/** 喂入一段解压文本（允许半行截断，残尾进 tail 续下段）。JSON 解析失败行静默跳过（与全量口径一致）。 */
export function foldChunk(s: FoldState, text: string): void {
  let buf = s.tail ? s.tail + text : text;
  const nl = buf.lastIndexOf("\n");
  if (nl < 0) {
    s.tail = buf;
    return;
  }
  s.tail = buf.slice(nl + 1);
  buf = buf.slice(0, nl);
  for (const line of buf.split("\n")) {
    if (!line || !line.trim()) continue;
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r || typeof r !== "object") continue;
    const t = r.type;
    if (t === "session") {
      // 新会话开始：模型归因状态重置（每文件一会话，防御跨会话残留）。
      s.provider = "unknown";
      s.model = "unknown";
      s.curTurn = -1;
      s.curStep = -1;
      const depth = Number(r.delegationDepth) || 0;
      s.meta = {
        sessionId: String(r.id || s.sessionIdHint),
        cwd: String(r.cwd || ""),
        title: "",
        createdAt: Number(r.createdAt) || 0,
        delegationDepth: depth,
        subagent: r.origin != null || r.parentSession != null || depth > 0,
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
      };
    } else if (t === "session/title") {
      if (s.meta && r.data && typeof r.data.title === "string") s.meta.title = r.data.title;
    } else if (t === "user/message") {
      if (s.meta) s.meta.userMessages++;
    } else if (t === "tool/call") {
      if (s.meta) s.meta.toolCalls++;
    } else if (t === "request/header") {
      const c = r.data?.header?.config;
      if (c && typeof c.model === "string") {
        s.provider = String(c.provider || "unknown");
        s.model = c.model;
      }
    } else if (t === "turn/start") {
      s.curTurn = Number(r.data?.turn) || 0;
      s.curStep = -1;
    } else if (t === "step/start") {
      s.curTurn = Number(r.data?.turn) || s.curTurn;
      s.curStep = Number(r.data?.step) || 0;
    } else if (t === "assistant/message") {
      if (s.meta) s.meta.assistantMessages++;
      const u = r.data?.usage;
      if (!u || typeof u.inputTokens !== "number" || typeof u.outputTokens !== "number") continue;
      if (typeof r.time !== "number" || !s.meta) continue;
      const scope = `${s.meta.sessionId}:${s.curTurn}:${s.curStep}`;
      const fact: UsageFact = {
        scope,
        sessionId: s.meta.sessionId,
        provider: s.provider,
        model: s.model,
        date: localDate(r.time),
        time: r.time,
        input: Number(u.inputTokens) || 0,
        output: Number(u.outputTokens) || 0,
        cacheRead: Number(u.cacheReadTokens) || 0,
        cacheWrite: Number(u.cacheWriteTokens) || 0,
        hasCache: u.cacheReadTokens != null || u.cacheWriteTokens != null,
      };
      const prev = s.scopeIndex.get(scope);
      if (prev !== undefined) s.facts[prev] = fact;
      else {
        s.scopeIndex.set(scope, s.facts.length);
        s.facts.push(fact);
      }
    }
  }
}

/** 折叠一个会话的 JSONL 文本为 UsageFact[] + SessionMeta（纯函数，可单测；= 全量 foldChunk 薄包装 + 尾行结算）。 */
export function foldJsonl(sessionIdHint: string, text: string): Fold {
  const s = newFoldState(sessionIdHint);
  foldChunk(s, text);
  if (s.tail) foldChunk(s, "\n"); // 无换行结尾的最后一行也要结算（旧 split 语义等价）
  return foldSnapshot(s);
}

const FILE_NAME = "session.v3.jsonl.zstd";

/** DSH 会话根目录：config.sessionsHome 优先，其次 $DSH_HOME/sessions，最后 ~/.dsh/sessions。 */
export function sessionsRoot(sessionsHome?: string): string {
  if (sessionsHome) return sessionsHome;
  const dshHome = process.env.DSH_HOME;
  if (dshHome) return join(dshHome, "sessions");
  return join(homedir(), ".dsh", "sessions");
}

/** 列出全部 workspace slug 下的会话文件（全局视图），排序保证确定性。 */
export async function listSessionFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  let slugs: string[] = [];
  try {
    slugs = await readdir(root);
  } catch {
    return out;
  }
  for (const slug of slugs) {
    let dirs: string[] = [];
    try {
      dirs = await readdir(join(root, slug));
    } catch {
      continue;
    }
    for (const dir of dirs) {
      const full = join(root, slug, dir, FILE_NAME);
      try {
        const s = await stat(full);
        if (s.isFile()) out.push(full);
      } catch {
        /* 非会话目录或缺文件：跳过 */
      }
    }
  }
  out.sort();
  return out;
}

/** 毫秒 → 本地日期 YYYY-MM-DD。 */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------------- zstd 帧边界（RFC 8878：只读帧头/块头，不解压内容） ---------------- */

const FRAME_MAGIC = 0xfd2fb528;
const LEGACY_MAGICS = [0x1eb52ffd, 0x2fb52815, 0x24b52f6d];

/** 从 start 走一个 zstd 帧，返回结束字节；半帧/坏帧/legacy → null。
 *  位布局以真帧反推 + fzstd 参考实现双重对表（勿凭 RFC 记忆改动）：
 *  FHD: bit7-6=FCS_flag(字节数=flag?1<<flag:single) bit5=Single_Segment bit3=Unused(须0) bit2=Checksum bit1-0=Did_flag(0/1/2/4B)。
 *  Block 头（24bit LE）: bit0=Last bit2-1=Type(0=Raws体size｜1=RLE体1B重复值｜2=Compressed体size｜3=坏) bit23-3=Size(21bit)。 */
function frameEnd(buf: Buffer, start: number): number | null {
  let off = start;
  if (off + 5 > buf.length) return null;
  const magic = buf.readUInt32LE(off);
  if (magic !== FRAME_MAGIC || LEGACY_MAGICS.includes(magic)) return null;
  off += 4;
  const fhd = buf.readUInt8(off);
  off += 1;
  if (fhd & 0x08) return null;
  const single = (fhd >> 5) & 1;
  const didFlag = fhd & 3;
  const checksum = (fhd >> 2) & 1;
  const fcsFlag = fhd >> 6;
  if (!single) off += 1; // Window_Descriptor
  off += (fcsFlag ? 1 << fcsFlag : single) + (didFlag === 3 ? 4 : didFlag);
  for (;;) {
    if (off + 3 > buf.length) return null;
    const bh = buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
    off += 3;
    const last = (bh & 1) !== 0;
    const type = (bh >> 1) & 3;
    const size = bh >>> 3;
    if (type === 3) return null;
    if (type === 1) {
      if (off + 1 > buf.length) return null; // RLE：1 字节重复值
      off += 1;
    } else {
      if (off + size > buf.length) return null; // Raws/Compressed：体长 = size
      off += size;
    }
    if (last) break;
  }
  if (checksum) off += 4;
  return off <= buf.length ? off : null;
}

/** 完整帧区间表（增量解码的水位线依据）。 */
export function frameSpans(buf: Buffer): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let off = 0;
  for (;;) {
    const end = frameEnd(buf, off);
    if (end === null || end <= off) break;
    spans.push([off, end]);
    off = end;
  }
  return spans;
}

/** 已消化完整帧的字节水位（= frameSpans 末区间终点；无完整帧为 0）。 */
export function frameWatermark(buf: Buffer): number {
  const spans = frameSpans(buf);
  return spans.length ? spans[spans.length - 1][1] : 0;
}

export function hintOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 2] || "unknown";
}

/** 读单个会话文件并全量折叠（首轮/失效重扫路径）。解码失败上抛，空 fold 兜底在 store 层决策。 */
export async function readFold(path: string): Promise<Fold> {
  return foldJsonl(hintOf(path), await decompressZstd(path));
}

/** 从持久 FoldState 续建运行时状态（scopeIndex 重建）。 */
export function reviveState(hint: string, saved: Pick<FoldState, "meta" | "provider" | "model" | "curTurn" | "curStep" | "facts" | "tail">): FoldState {
  const s = newFoldState(hint);
  s.meta = saved.meta;
  s.provider = saved.provider;
  s.model = saved.model;
  s.curTurn = saved.curTurn;
  s.curStep = saved.curStep;
  s.facts = saved.facts;
  s.tail = saved.tail || "";
  for (let i = 0; i < s.facts.length; i++) s.scopeIndex.set(s.facts[i].scope, i);
  return s;
}

/** 增量续跑：把 `fromBytes`（上次完整帧水位）之后的新增帧并进 state。
 *  @returns 新水位；无新增完整帧返回原值。解码失败抛错（调用方回退全量）。 */
export async function foldFrom(path: string, state: FoldState, fromBytes: number): Promise<number> {
  const buf = await readFile(path);
  const spans = frameSpans(buf);
  const watermark = spans.length ? spans[spans.length - 1][1] : 0;
  if (watermark <= fromBytes) return fromBytes;
  const fresh = spans.filter(([s]) => s >= fromBytes);
  const text = await decompressSpans(buf, fresh);
  foldChunk(state, text);
  return watermark;
}

/** 新增帧区间解压：CLI（stdin 吃拼接帧）优先；无 CLI 时 node:zlib 按帧逐个解。
 *  zstdCliMissing 一旦置真（本机没装 CLI）不再重试；输出超限等运行期错误照常抛，由调用方回退全量。 */
let zstdCliMissing = false;
async function decompressSpans(buf: Buffer, spans: Array<[number, number]>): Promise<string> {
  if (!zstdCliMissing) {
    try {
      const seg = Buffer.concat(spans.map(([s, e]) => buf.subarray(s, e)));
      return await zstdStdin(seg);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") zstdCliMissing = true;
      else throw err;
    }
  }
  let out = "";
  for (const [s, e] of spans) out += zstdDecompressSync(buf.subarray(s, e)).toString("utf8");
  return out;
}

/** `zstd -dc` 子进程喂 stdin（execFile 的 input 选项不在 @types 类型里，自管流 + 尺寸护栏）。 */
function zstdStdin(seg: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("zstd", ["-dc"]);
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      out += d;
      if (out.length > 256 * 1024 * 1024) {
        child.kill();
        reject(new Error("zstd output exceeds 256MB guard"));
      }
    });
    child.stderr.on("data", (d: string) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`zstd exit ${code}: ${err.slice(0, 200)}`))));
    child.stdin.end(seg);
  });
}
