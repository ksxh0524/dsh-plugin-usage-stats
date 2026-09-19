/** 增量扫描的存量持久化：折叠状态落 `<DSH_HOME>/cache/usage-stats.folds.json`。
 *  语义 = 每个会话文件一行 {file, size, mtimeMs, ino, bytes(已消化完整帧水位), FoldState 快照}；
 *  host 重启后：未变文件 0 解压直接复用，追加文件只解新增帧（foldFrom），
 *  size 变小 / inode 变化（文件被替换）→ 该行失效整文件重解。
 *  水位铁律：bytes 只能是 frameWatermark 的真实完整帧边界（文件尾半帧不计），
 *  否则追加后跨水位的帧会被漏掉；半帧尾巴等下次追加补齐。
 *  写盘策略 = 单次扫描若有推进则 tmp+rename 原子落一次；坏文件（JSON 解析失败）静默作废从零开始。
 *
 *  墓碑账本（v4）：会话文件被删 ≠ 用量没发生过。flush 时消失文件的行不直接丢弃，
 *  其 facts 按 sessionId 晋升为墓碑（tomb），总览 = 活文件 folds + 墓碑 folds。
 *  同 sessionId 的活文件重现（恢复/移动回来）→ 活数据权威，墓碑让位，不 double count。
 *  瞬时解码失败的活文件（行保留、返回空 fold）不触发墓碑升降。清账唯一路径 = 删 cache 文件。
 *
 *  ⚠ 版本铁律：foldJsonl/foldFrom/归因语义任何变化必须 bump VERSION——旧快照里冻结的是
 *  当时算出的 facts，永不回改（实测教训×2：v1 scanner 误产 unknown facts 被增量状态带病复用；
 *  v2 全量分支丢归因游标致追加 batch 批量误记 unknown——两次都只能靠版本门整体作废）。 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { foldFrom, frameWatermark, hintOf, readFold, reviveState, type Fold, type FoldState } from "./scanner.ts";

/** 存量格式+折叠语义的联合版本：与磁盘 payload.version 不符 = 冷启动全量重扫。 */
export const VERSION = 5; // v5: SessionMeta 新增 parentId（全家桶血缘边），旧快照整体作废重扫一次

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

/** 已删会话的墓碑：该 session 最后一次被扫到的 facts 全量（scope 去重已在行内完成）。
 *  同文件正常只属一个 session（多 session 行是防御性兼容）：晋升时按 fact.sessionId 分组，
 *  meta 只挂 sessionId 对得上的那组，对不上记 null（画像缺失不影响 token 口径）。 */
export interface TombRow {
  sessionId: string;
  /** 最后一次见到的文件路径（人读溯源用，不参与键匹配）。 */
  file: string;
  deletedAt: number;
  meta: FoldState["meta"];
  facts: FoldState["facts"];
}

export class FoldStore {
  readonly file: string;
  rows = new Map<string, UnitRow>();
  /** 墓碑账本：已删会话文件的最后已知 facts（key = sessionId；活文件重现即让位）。 */
  tombs = new Map<string, TombRow>();
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
        if (Array.isArray(parsed.tombs)) {
          for (const t of parsed.tombs) {
            if (t && typeof t.sessionId === "string" && Array.isArray(t.facts)) this.tombs.set(t.sessionId, t);
          }
        }
      }
    } catch {
      /* 缺文件/坏文件/版本不符 = 冷启动（含 v3 存量：墓碑字段缺失，按铁律整体作废重扫一次） */
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
    // 游标必须落终态实值（header 稀疏跨 turn 有效，增量续跑靠它归因；曾硬编码 unknown/-1/-1，
    // 导致追加 batch 的 usage 批量误记 unknown/unknown，v3 版本门作废带病存量）。
    let full: FoldState;
    try {
      full = await readFold(path);
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
      meta: full.meta,
      provider: full.provider,
      model: full.model,
      curTurn: full.curTurn,
      curStep: full.curStep,
      facts: full.facts,
      tail: full.tail,
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

  /** 清理消失文件 + 原子落盘（仅 dirty 时写）。
   *  消失文件的行先晋升墓碑（已扫用量不陪葬），再删行；随后按现存行裁墓碑
   *  （同 sessionId 活着即活数据权威，防复活 double count）。 */
  async flush(aliveFiles: Set<string>): Promise<void> {
    for (const key of [...this.rows.keys()]) {
      if (aliveFiles.has(key)) continue;
      this.promoteRow(key);
      this.rows.delete(key);
    }
    for (const key of [...this.states.keys()]) if (!aliveFiles.has(key)) this.states.delete(key);
    this.pruneTombs();
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await mkdir(dirname(this.file), { recursive: true });
      const payload = { version: VERSION, units: [...this.rows.values()], tombs: [...this.tombs.values()] };
      const tmp = this.file + ".tmp";
      await writeFile(tmp, JSON.stringify(payload));
      await rename(tmp, this.file);
    } catch {
      /* cache 写失败不影响查询，下次再试 */
    }
  }

  /** 消失行晋升墓碑：按 fact.sessionId 分组（常态一组），空 facts 行直接丢弃。 */
  private promoteRow(path: string): void {
    const row = this.rows.get(path);
    if (!row || row.facts.length === 0) return;
    const bySession = new Map<string, FoldState["facts"]>();
    for (const f of row.facts) {
      const g = bySession.get(f.sessionId);
      if (g) g.push(f);
      else bySession.set(f.sessionId, [f]);
    }
    const now = Date.now();
    for (const [sid, facts] of bySession) {
      this.tombs.set(sid, {
        sessionId: sid,
        file: path,
        deletedAt: now,
        meta: row.meta && row.meta.sessionId === sid ? row.meta : null,
        facts,
      });
    }
    this.dirty = true;
  }

  /** 按现存行裁墓碑：tomb.sessionId 仍被任一活行产出（行 facts 或 meta）即删墓碑，活数据永远权威。
   *  依据必须用 rows 而非本轮返回的 folds：瞬时解码失败的活文件返回空 fold 但行保留，
   *  按返回 folds 裁会误判该 session 已消失。 */
  private pruneTombs(): void {
    if (this.tombs.size === 0) return;
    const live = new Set<string>();
    for (const row of this.rows.values()) {
      if (row.meta) live.add(row.meta.sessionId);
      for (const f of row.facts) live.add(f.sessionId);
    }
    for (const sid of [...this.tombs.keys()]) {
      if (live.has(sid)) {
        this.tombs.delete(sid);
        this.dirty = true;
      }
    }
  }

  /** 墓碑 folds（总览输入；与活 folds 同构，scannedFiles 口径不含它们）。 */
  tombFolds(): Fold[] {
    return [...this.tombs.values()].map((t) => ({ facts: t.facts, meta: t.meta ?? null }));
  }
}
