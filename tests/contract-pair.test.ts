/** 两端契约配对门（AGENTS「两端改名必须同步」的机器化）：
 *  服务端真解析（运行时 SRC 标记 + 网关 methodParameterNames 语义的函数源码形参解析）
 *  ↔ 浏览器半真声明（lib/client.js 文本提取的 descriptor 调用点与固定字段）。
 *  改任一端而忘另一端 = 本测试红灯。v3 曾为 without inject 误诊半天（真因是 fiber 可见性
 *  而非契约错位），但契约错位这条风险真实存在，从此由机器兜底而非人肉对表。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UsageStatsService } from "../src/cordis.ts";

const MARKER_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";
const CLIENT = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
const SERVER = readFileSync(fileURLToPath(new URL("../src/cordis.ts", import.meta.url)), "utf8");

/** 网关 methodParameterNames 的解析复刻（与 cordis.test.ts 同规则）：括号内 → 逗号切分 → trim → 纯标识符。 */
function srcParamNames(fn: Function): string[] {
  const source = fn.toString();
  const open = source.indexOf("(");
  const close = source.indexOf(")", open + 1);
  const inside = source.slice(open + 1, close);
  return inside
    .split(",")
    .map((token) => token.trim())
    .filter((token) => /^[A-Za-z_$][\w$]*$/.test(token));
}

interface RemoteMethodsMarker {
  version: number;
  methods: Array<{ method: string; invocation: { kind: string } }>;
}

test("client descriptor 调用点全部提取且无漏网（防绕过式新增方法）", () => {
  const calls = [...CLIENT.matchAll(/descriptor\("([^"]+)",\s*"([^"]+)"\)/g)];
  assert.ok(calls.length > 0, "必须至少有一个 descriptor 调用点");
  // descriptor( 在文件中出现的次数 = 1 处定义 + N 处调用；对不上说明有调用点没被上面的正则抓到。
  const occurrences = (CLIENT.match(/\bdescriptor\(/g) ?? []).length;
  assert.equal(occurrences, calls.length + 1, "descriptor 调用点数与提取数不一致（提取正则失配）");
});

test("两端方法集与 wire 参数名一一对应", () => {
  const marker = Object.getOwnPropertyDescriptor(UsageStatsService.prototype, MARKER_KEY) as { value: RemoteMethodsMarker } | undefined;
  assert.ok(marker, "服务端必须挂 remote-methods 标记（原型字符串键）");
  const proto = UsageStatsService.prototype as unknown as Record<string, Function>;
  const serverMethods = new Map<string, string[]>();
  for (const entry of marker!.value.methods) {
    assert.equal(entry.invocation.kind, "direct", `方法 ${entry.method} 的 invocation 形态`);
    assert.equal(typeof proto[entry.method], "function", `标记声明了 ${entry.method} 但实现缺失`);
    serverMethods.set(entry.method, srcParamNames(proto[entry.method]!));
  }

  const clientCalls = [...CLIENT.matchAll(/descriptor\("([^"]+)",\s*"([^"]+)"\)/g)];
  assert.equal(clientCalls.length, serverMethods.size, "方法数量两端不一致");
  for (const [, method, param] of clientCalls) {
    assert.ok(serverMethods.has(method), `client 声明了服务端没有的方法 ${method}`);
    const params = serverMethods.get(method)!;
    assert.equal(params.length, 1, `服务端 ${method} 应为单参数（descriptor() 只编码单参数形态）`);
    assert.equal(params[0], param, `两端 ${method} 的 wire 参数名错位：server=${params[0]} client=${param}`);
  }
});

test("descriptor 固定字段与客户端挂载路径两端一致", () => {
  // id 前缀 = SETTINGS_NS + "#usageStats/"；service/namespace 字面量 = usageStats。
  assert.match(CLIENT, /id:\s*SETTINGS_NS\s*\+\s*"#usageStats\/"\s*\+\s*method/);
  assert.match(CLIENT, /service:\s*"usageStats"/);
  assert.match(CLIENT, /namespace:\s*"usageStats"/);
  assert.match(CLIENT, /source:\s*"json"/);
  assert.match(CLIENT, /mode:\s*"strict"/);
  // 服务端 provide 的命名空间必须同为 usageStats（网关按 namespace/method 路由）。
  assert.match(SERVER, /provide\(\s*"usageStats"/);
  // 浏览器半取服务必须走名字解析（属性式在动态 fiber 被可见性隔离拒绝，见 AGENTS 宿主契约）。
  assert.match(CLIENT, /ctx\.get\("remote\.usageStats"\)/);
  assert.doesNotMatch(CLIENT, /ctx\.remote\.usageStats\b/, "属性式访问会 throw without inject");
});
