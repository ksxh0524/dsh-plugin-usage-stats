/** 增量扫描正确性：zstd 帧边界（RFC 8878 walker）+ foldFrom 与全量重放等价 + FoldStore 持久化/失效。
 *  多帧 fixture 用真 zstd CLI 拼接生成（无 CLI 环境整体 skip——walker 的字节语义只有真帧能说清）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foldFrom, foldJsonl, foldSnapshot, frameSpans, frameWatermark, newFoldState } from "../src/scanner.ts";
import { FoldStore, VERSION } from "../src/store.ts";

let ZSTD_OK = false;
try {
  ZSTD_OK = execFileSync("zstd", ["--version"], { encoding: "utf8" }).includes("v");
} catch {
  ZSTD_OK = false;
}

const SESSION_LINES = [
  JSON.stringify({ type: "session", time: Date.now(), id: "s-inc", cwd: "/w", createdAt: Date.now() }),
  JSON.stringify({ type: "turn/start", time: Date.now(), data: { turn: 1 } }),
  JSON.stringify({ type: "request/header", time: Date.now(), data: { header: { config: { provider: "prov-a", model: "m-1" } } } }),
  JSON.stringify({ type: "assistant/message", time: Date.now(), data: { usage: { inputTokens: 7, outputTokens: 9, cacheReadTokens: 3 } } }),
];
const MORE_LINES = [
  JSON.stringify({ type: "tool/call", time: Date.now(), data: { name: "bash" } }),
  JSON.stringify({ type: "user/message", time: Date.now(), data: { content: "go" } }),
  JSON.stringify({ type: "turn/start", time: Date.now(), data: { turn: 2 } }),
  JSON.stringify({ type: "request/header", time: Date.now(), data: { header: { config: { provider: "prov-a", model: "m-1" } } } }),
  // 与第一轮同 scope 的重试样本 → last-wins
  JSON.stringify({ type: "assistant/message", time: Date.now(), data: { usage: { inputTokens: 1, outputTokens: 2 } } }),
  JSON.stringify({ type: "step/start", time: Date.now(), data: { turn: 2, step: 1 } }),
  JSON.stringify({ type: "assistant/message", time: Date.now(), data: { usage: { inputTokens: 100, outputTokens: 50 } } }),
];

let TMP = "";
function newTmpFile(): string {
  return join(TMP, `f-${Math.random().toString(36).slice(2)}.zst`);
}

async function compressFrame(text: string): Promise<Buffer> {
  const src = newTmpFile();
  const dst = newTmpFile();
  await writeFile(src, text);
  execFileSync("zstd", ["-f", "--no-check", "-1", src, "-o", dst]);
  return readFile(dst);
}

test("zstd 帧 walker：多帧拼接的边界识别、半帧截断、垃圾即停", { skip: ZSTD_OK ? false : "无 zstd CLI" }, async () => {
  TMP = await mkdtemp(join(tmpdir(), "usg-walk-"));
  const f1 = await compressFrame(SESSION_LINES.join("\n") + "\n");
  const f2 = await compressFrame(MORE_LINES.join("\n") + "\n");
  const joined = Buffer.concat([f1, f2]);
  const spans = frameSpans(joined);
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0], [0, f1.length]);
  assert.deepEqual(spans[1], [f1.length, joined.length]);
  assert.equal(frameWatermark(joined), joined.length);
  // 截半帧：水位停在完整帧边界
  const cut = joined.subarray(0, f1.length + Math.floor(f2.length / 2));
  assert.equal(frameWatermark(cut), f1.length);
  assert.equal(frameSpans(cut).length, 1);
  // 尾追垃圾：walker 即停，不吞好帧
  const dirty = Buffer.concat([joined, Buffer.from([1, 2, 3, 4, 5])]);
  assert.deepEqual(frameSpans(dirty).length, 2);
});

test("foldFrom 增量重放 === 全量 foldJsonl（两帧 + 跨帧半行），逐字段等价", { skip: ZSTD_OK ? false : "无 zstd CLI" }, async () => {
  TMP = TMP || (await mkdtemp(join(tmpdir(), "usg-inc-")));
  // 故意把 MORE_LINES[0] 从中间劈开：前半压进帧1尾、后半作为帧2头（跨帧行必须由 tail 机制缝合）。
  const half = Math.floor(MORE_LINES[0].length / 2);
  const groupA = [...SESSION_LINES, MORE_LINES[0].slice(0, half)];
  const groupB = [MORE_LINES[0].slice(half), ...MORE_LINES.slice(1)];
  const f1 = await compressFrame(groupA.join("\n") + "\n");
  const f2 = await compressFrame(groupB.join("\n") + "\n");
  const file = join(TMP, "session.v3.jsonl.zstd");
  await writeFile(file, Buffer.concat([f1, f2]));

  // 全量基准
  const full = foldJsonl("hint", [...groupA, ...groupB].join("\n") + "\n");

  // 增量路径 1：从 0 开始吃两帧
  const s1 = newFoldState("hint");
  await foldFrom(file, s1, 0);
  assert.deepEqual(foldSnapshot(s1), full, "增量自零 === 全量");

  // 增量路径 2：只有帧1 时推进（水位=帧1尾），追加帧2 后再从水位续吃
  const file2 = join(TMP, "session.v3.jsonl.b.zstd");
  await writeFile(file2, f1);
  const s2 = newFoldState("hint");
  const wm1 = await foldFrom(file2, s2, 0);
  assert.equal(wm1, f1.length, "单帧文件水位精确");
  await writeFile(file2, Buffer.concat([f1, f2]));
  const wm2 = await foldFrom(file2, s2, wm1);
  assert.equal(wm2, f1.length + f2.length, "追加后水位推进到全帧尾");
  assert.deepEqual(foldSnapshot(s2), full, "分段推进与一次到位等价（重试 last-wins + 计数单调）");
});

test("FoldStore：冷启动全量 → 未变复用零解压 → 追加走增量 → 持久化重启复用", { skip: ZSTD_OK ? false : "无 zstd CLI" }, async () => {
  TMP = TMP || (await mkdtemp(join(tmpdir(), "usg-store-")));
  const root = join(TMP, "ws", "s-inc");
  const file = join(root, "session.v3.jsonl.zstd");
  await mkdir(root, { recursive: true });
  const f1 = await compressFrame(SESSION_LINES.join("\n") + "\n");
  const f2 = await compressFrame(MORE_LINES.join("\n") + "\n");
  await writeFile(file, f1);

  const store = new FoldStore(join(TMP, "ws"));
  const st1 = await stat(file);
  const foldA = await store.foldFor(file, { size: st1.size, mtimeMs: st1.mtimeMs, ino: st1.ino });
  assert.equal(foldA.facts.length, 1);
  assert.equal(store.rows.get(file)!.bytes, f1.length, "首轮记录真实帧水位");

  // 未变：直接复用（行对象同一引用 = 0 解压）
  const foldA2 = await store.foldFor(file, { size: st1.size, mtimeMs: st1.mtimeMs, ino: st1.ino });
  assert.equal(foldA2.facts, foldA.facts, "未变文件复用存量 fold 引用");

  // 追加第二帧 → 增量推进，等价全量
  await writeFile(file, Buffer.concat([f1, f2]));
  const st2 = await stat(file);
  const foldB = await store.foldFor(file, { size: st2.size, mtimeMs: st2.mtimeMs, ino: st2.ino });
  const expected = foldJsonl("s-inc", SESSION_LINES.join("\n") + "\n" + MORE_LINES.join("\n") + "\n");
  assert.deepEqual(
    foldB.facts.map((f) => `${f.scope}:${f.input}`),
    expected.facts.map((f) => `${f.scope}:${f.input}`),
  );
  assert.equal(foldB.meta!.userMessages, 1);
  assert.equal(store.rows.get(file)!.bytes, f1.length + f2.length, "增量水位推进到文件尾");

  // 落盘 + 新实例（= host 重启）复用存量
  await store.flush(new Set([file]));
  const reopened = new FoldStore(join(TMP, "ws"));
  await reopened.load();
  assert.ok(reopened.rows.has(file), "持久化行恢复");
  const foldC = await reopened.foldFor(file, { size: st2.size, mtimeMs: st2.mtimeMs, ino: st2.ino });
  assert.equal(foldC.facts.length, expected.facts.length, "重启后未变文件 0 重解出同数事实");
});

test("版本门：低于当前 VERSION 的存量 payload 整体作废冷重扫（unknown facts 冻结教训的保险丝）", { skip: ZSTD_OK ? false : "无 zstd CLI" }, async () => {
  const T = await mkdtemp(join(tmpdir(), "usg-ver-")); // 独立 tmp：cache 文件不与其他用例共享
  const ws = join(T, "ws-ver");
  const root = join(ws, "s-ver");
  const file = join(root, "session.v3.jsonl.zstd");
  await mkdir(root, { recursive: true });
  await writeFile(file, await compressFrame(SESSION_LINES.join("\n") + "\n"));
  const store = new FoldStore(ws);
  const st = await stat(file);
  await store.foldFor(file, { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
  await store.flush(new Set([file]));

  // 盘上必须是当前版本（flush 写 VERSION，不是历史常数）。constructor(root=sessions 区) → cache 落在其父级。
  const cacheFile = join(T, "cache", "usage-stats.folds.json");
  const payload = JSON.parse(await readFile(cacheFile, "utf8"));
  assert.equal(payload.version, VERSION, "落盘 payload 带当前版本");
  assert.ok(payload.version >= 3, "版本门至少为 3（v1 = 曾冻结 unknown facts 的带病存量；v2 = 全量分支丢归因游标）");

  // 手动降级 = 模拟旧版折叠逻辑的存量：load 必须整体拒收，行清零。
  payload.version = 1;
  await writeFile(cacheFile, JSON.stringify(payload));
  const cold = new FoldStore(ws);
  await cold.load();
  assert.equal(cold.rows.size, 0, "旧版本 payload 不得复用任何行");
  // 拒收后重扫 = 全量重建并以当前版本回写。
  const fold = await cold.foldFor(file, { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
  assert.equal(fold.facts.length, 1, "冷重扫产出正常事实");
  await cold.flush(new Set([file]));
  assert.equal(JSON.parse(await readFile(cacheFile, "utf8")).version, VERSION, "回写恢复当前版本");
});

test("FoldStore 全量落盘保留归因游标：稀疏 header 跨 batch 追加不产 unknown（v2 丢游标回归）", { skip: ZSTD_OK ? false : "无 zstd CLI" }, async () => {
  // 真实 DSH 形态：header 只在首 turn 出现一次（跨 turn 持续有效），追加 batch 内无 header、
  // 且匹配的 turn/start 已在上一 batch 被消费——增量归因全靠存量游标。
  const T = await mkdtemp(join(tmpdir(), "usg-cursor-"));
  const ws = join(T, "ws-cur");
  const root = join(ws, "s-cur");
  const file = join(root, "session.v3.jsonl.zstd");
  await mkdir(root, { recursive: true });
  const now = Date.now();
  const L = (type: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type, time: now, ...extra });
  const batch1 = [
    L("session", { id: "s-cur", cwd: "/w", createdAt: now }),
    L("turn/start", { data: { turn: 1 } }),
    L("step/start", { data: { turn: 1, step: 1 } }),
    L("request/header", { data: { header: { config: { provider: "prov-a", model: "m-1" } } } }),
    L("assistant/message", { data: { usage: { inputTokens: 10, outputTokens: 1 } } }),
    L("step/start", { data: { turn: 1, step: 2 } }),
    L("assistant/message", { data: { usage: { inputTokens: 11, outputTokens: 2 } } }),
  ];
  // batch2：新 turn 无 header（上游常态），step/start 自带 turn/step 恢复位置，但 provider 只能来自存量游标。
  const batch2 = [
    L("turn/start", { data: { turn: 2 } }),
    L("step/start", { data: { turn: 2, step: 1 } }),
    L("assistant/message", { data: { usage: { inputTokens: 12, outputTokens: 3 } } }),
    L("step/start", { data: { turn: 2, step: 2 } }),
    L("assistant/message", { data: { usage: { inputTokens: 13, outputTokens: 4 } } }),
  ];
  const f1 = await compressFrame(batch1.join("\n") + "\n");
  const f2 = await compressFrame(batch2.join("\n") + "\n");
  await writeFile(file, f1);

  const store = new FoldStore(ws);
  const st1 = await stat(file);
  const foldA = await store.foldFor(file, { size: st1.size, mtimeMs: st1.mtimeMs, ino: st1.ino });
  assert.equal(foldA.facts.length, 2);
  // 全量分支必须落盘终态游标（v2 在此硬编码 unknown/-1/-1，是本回归的抓点）。
  const row = store.rows.get(file)!;
  assert.equal(row.provider, "prov-a", "全量落盘保留 header 归因");
  assert.equal(row.model, "m-1");
  assert.equal(row.curTurn, 1);
  assert.equal(row.curStep, 2);

  // 追加 batch2 → 增量：等价一次性全量，全员 prov-a/m-1、零 unknown、scope 正确。
  await writeFile(file, Buffer.concat([f1, f2]));
  const st2 = await stat(file);
  const foldB = await store.foldFor(file, { size: st2.size, mtimeMs: st2.mtimeMs, ino: st2.ino });
  const expected = foldJsonl("s-cur", [...batch1, ...batch2].join("\n") + "\n");
  assert.deepEqual(
    foldB.facts.map((f) => `${f.scope}:${f.provider}/${f.model}:${f.input}`),
    expected.facts.map((f) => `${f.scope}:${f.provider}/${f.model}:${f.input}`),
  );
  assert.ok(foldB.facts.length === 4 && foldB.facts.every((f) => f.provider === "prov-a" && f.model === "m-1"), "稀疏 header 下增量不得产 unknown");
  assert.deepEqual(
    foldB.facts.map((f) => f.scope),
    ["s-cur:1:1", "s-cur:1:2", "s-cur:2:1", "s-cur:2:2"],
    "scope 不得错成 -1:-1",
  );
});
