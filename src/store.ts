/** 增量扫描的存量持久化：折叠状态落 `<DSH_HOME>/cache/usage-stats.folds.json`。
 *  语义 = 每个会话文件一行 {file, size, mtimeMs, ino, bytes(已消化完整帧水位), FoldState 快照}；
 *  host 重启后：未变文件 0 解压直接复用，追加文件只解新增帧（foldFrom），
 *  size 变小 / inode 变化（文件被替换）→ 该行失效整文件重解。
 *  水位铁律：bytes 只能是 frameWatermark 的真实完整帧边界（文件尾半帧不计），
 *  否则追加后跨水位的帧会被漏掉；半帧尾巴等下次追加补齐。
 *  写盘策略 = 单次扫描若有推进则 tmp+rename 原子落一次；坏文件（JSON 解析失败）静默作废从零开始。
 *  ⚠ 版本铁律：foldJsonl/foldFrom/归因语义任何变化必须 bump VERSION——旧快照里冻结的是
 *  当时算出的 facts，永不回改（实测教训：scanner 早期误产 unknown-model facts，被增量状态
 *  带病复用，页面 unknown 行在逻辑修复后仍不消失，只能靠版本门整体作废）。 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { foldFrom, frameWatermark, hintOf, readFold, reviveState, type Fold, type FoldState } from "./scanner.ts";

/** 存量格式+折叠语义的联合版本：与磁盘 payload.version 不符 = 冷启动全量重扫。 */
export const VERSION = 2;

export interface UnitRow {
  file: string;
  size: number;
  mtimeMs: number;
  ino: number;
  /** 已消化的完整帧字节水位；0 = 帧链不可识（legacy/坏头），每次走全量。 */
  bytes: number;
  meta: FoldState["meta"];
  provider: string;
  model: string;
  curTurn: number;
  curStep: number;
  facts: FoldState["facts"];
  tail: string;
}

export class FoldStore {
  readonly file: string;
  rows = new Map<string, UnitRow>();
  private states = new Map<string, FoldState>();
  private loaded = false;
  dirty = false;

  /** root = sessions 目录；cache 落其同级的 cache/ 下（sessionsHome 自定义时同样成立）。 */
  constructor(root: string) {
    this.file = join(dirname(root), "cache", "usage-stats.folds.json");
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      if (parsed && parsed.version === VERSION && Array.isArray(parsed.units)) {
        for (const u of parsed.units) if (u && typeof u.file === "string" && typeof u.bytes === "number") this.rows.set(u.file, u);
      }
    } catch {
      /* 缺文件/坏文件 = 冷启动 */
    }
  }

  /** 取得该文件最新折叠结果；内部按行状态决定 复用 / 增量 / 全量。 */
  async foldFor(path: string, st: { size: number; mtimeMs: number; ino: number }): Promise<Fold> {
    const row = this.rows.get(path);
    if (row && row.ino === st.ino && row.size === st.size && row.mtimeMs === st.mtimeMs) {
      return this.foldOf(row); // 未变：直接复用存量
    }
    if (row && row.ino === st.ino && row.bytes > 0 && st.size > row.size) {
      // 追加增长：只解新增完整帧。水位没推进（文件尾半帧未补齐）也正常，等下次。
      try {
        const next = await foldFrom(path, this.stateOf(path, row), row.bytes);
        if (next !== row.bytes) this.dirty = true;
        row.bytes = next;
        row.size = st.size;
        row.mtimeMs = st.mtimeMs;
        this.syncRow(path, row);
        return this.foldOf(row);
      } catch {
        /* 增量失败：落到全量 */
      }
    }
    // 冷启动 / 文件被替换 / size 倒退 / 无水位：整文件重解，水位取真实帧边界（尾半帧留给下次）。
    let fold: Fold;
    try {
      fold = await readFold(path);
    } catch {
      // 解码失败：不落行——增量续跑要求存量状态完整（首帧含 session/meta 行），坏文件每轮重试（与旧缓存语义一致）。
      return { facts: [], meta: null };
    }
    const buf = await readFile(path).catch(() => null);
    const wm = buf ? frameWatermark(buf) : 0;
    const fresh: UnitRow = {
      file: path,
      size: st.size,
      mtimeMs: st.mtimeMs,
      ino: st.ino,
      bytes: wm,
      meta: fold.meta,
      provider: "unknown",
      model: "unknown",
      curTurn: -1,
      curStep: -1,
      facts: fold.facts,
      tail: "",
    };
    this.rows.set(path, fresh);
    this.states.delete(path); // 全量重解后旧 state 作废，下次增量从快照重建
    this.dirty = true;
    return this.foldOf(fresh);
  }

  /** 增量成功后把 state 的游标/计数/facts 回写行（bytes 由调用处单独赋值）。 */
  private syncRow(path: string, row: UnitRow): void {
    const s = this.states.get(path);
    if (!s) return;
    row.meta = s.meta;
    row.provider = s.provider;
    row.model = s.model;
    row.curTurn = s.curTurn;
    row.curStep = s.curStep;
    row.facts = s.facts;
    row.tail = s.tail;
  }

  private stateOf(path: string, row: UnitRow): FoldState {
    let s = this.states.get(path);
    if (!s) {
      s = reviveState(hintOf(path), row);
      this.states.set(path, s);
    }
    return s;
  }

  private foldOf(row: UnitRow): Fold {
    // facts/meta 是共享引用；同一次扫描内消费方只读，安全。
    return { facts: row.facts, meta: row.meta ?? null };
  }

  /** 清理消失文件 + 原子落盘（仅 dirty 时写）。 */
  async flush(aliveFiles: Set<string>): Promise<void> {
    for (const key of [...this.rows.keys()]) if (!aliveFiles.has(key)) this.rows.delete(key);
    for (const key of [...this.states.keys()]) if (!aliveFiles.has(key)) this.states.delete(key);
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await mkdir(dirname(this.file), { recursive: true });
      const payload = { version: VERSION, units: [...this.rows.values()] };
      const tmp = this.file + ".tmp";
      await writeFile(tmp, JSON.stringify(payload));
      await rename(tmp, this.file);
    } catch {
      /* cache 写失败不影响查询，下次再试 */
    }
  }
}
