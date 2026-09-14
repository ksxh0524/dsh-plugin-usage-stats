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
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { zstdDecompressSync } from "node:zlib";

const execFileAsync = promisify(execFile);

/** 多帧 zstd 解码：会话文件是 append-only 的多帧拼接，node:zlib 只解首帧。
 *  首选 `zstd -dc`（正确处理 concatenated frames），无 CLI 时退回 node:zlib 单帧（小会话可用）。 */
async function decompressZstd(path: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("zstd", ["-dc", path], { maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  } catch {
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
  /** v2 会话级计数（逐行顺带 O(1)，不做去重）：user/message 行数。 */
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

/** 折叠一个会话的 JSONL 文本为 UsageFact[] + SessionMeta（纯函数，可单测）。 */
export function foldJsonl(sessionIdHint: string, text: string): Fold {
  const facts: UsageFact[] = [];
  const scopeIndex = new Map<string, number>();
  let meta: SessionMeta | null = null;
  let current = { provider: "unknown", model: "unknown" };
  let curTurn = -1;
  let curStep = -1;
  for (const line of text.split("\n")) {
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
      current = { provider: "unknown", model: "unknown" };
      curTurn = -1;
      curStep = -1;
      const depth = Number(r.delegationDepth) || 0;
      meta = {
        sessionId: String(r.id || sessionIdHint),
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
      if (meta && r.data && typeof r.data.title === "string") meta.title = r.data.title;
    } else if (t === "user/message") {
      if (meta) meta.userMessages++;
    } else if (t === "tool/call") {
      if (meta) meta.toolCalls++;
    } else if (t === "request/header") {
      const c = r.data?.header?.config;
      if (c && typeof c.model === "string") current = { provider: String(c.provider || "unknown"), model: c.model };
    } else if (t === "turn/start") {
      curTurn = Number(r.data?.turn) || 0;
      curStep = -1;
    } else if (t === "step/start") {
      curTurn = Number(r.data?.turn) || curTurn;
      curStep = Number(r.data?.step) || 0;
    } else if (t === "assistant/message") {
      if (meta) meta.assistantMessages++;
      const u = r.data?.usage;
      if (!u || typeof u.inputTokens !== "number" || typeof u.outputTokens !== "number") continue;
      if (typeof r.time !== "number" || !meta) continue;
      const sid = meta ? meta.sessionId : sessionIdHint;
      const scope = `${sid}:${curTurn}:${curStep}`;
      const fact: UsageFact = {
        scope,
        sessionId: sid,
        provider: current.provider,
        model: current.model,
        date: localDate(r.time),
        time: r.time,
        input: Number(u.inputTokens) || 0,
        output: Number(u.outputTokens) || 0,
        cacheRead: Number(u.cacheReadTokens) || 0,
        cacheWrite: Number(u.cacheWriteTokens) || 0,
        hasCache: u.cacheReadTokens != null || u.cacheWriteTokens != null,
      };
      const prev = scopeIndex.get(scope);
      if (prev !== undefined) facts[prev] = fact;
      else {
        scopeIndex.set(scope, facts.length);
        facts.push(fact);
      }
    }
  }
  return { facts, meta };
}

/** 读单个会话文件并折叠（多帧解码；v1 不做同文件尾部增量，文件级缓存见 aggregate）。 */
export async function readFold(path: string): Promise<Fold> {
  let text: string;
  try {
    text = await decompressZstd(path);
  } catch {
    return { facts: [], meta: null };
  }
  const parts = path.split("/");
  const hint = parts[parts.length - 2] || "unknown";
  return foldJsonl(hint, text);
}
