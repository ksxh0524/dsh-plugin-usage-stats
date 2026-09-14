/** 增量扫描正确性：zstd 帧边界（RFC 8878 walker）+ foldFrom 与全量重放等价 + FoldStore 持久化/失效。
 *  多帧 fixture 用真 zstd CLI 拼接生成（无 CLI 环境整体 skip——walker 的字节语义只有真帧能说清）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foldFrom, foldJsonl, foldSnapshot, frameSpans, frameWatermark, newFoldState } from "../src/scanner.ts";
import { FoldStore } from "../src/store.ts";

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
