# dsh-plugin-usage-stats

[English](./README.md)

DSH（DeepSeek Harness）Web GUI 的用量统计插件（v3）：**设置里的独立「Token 用量」页**——跨全部 workspace 的全局报表（与会话无关）：日期范围选择器（默认今天；预设 今天 / 近3天 / 近7天 / 近30天 / 全部）、**按模型与服务商过滤**、KPI 网格、按模型 / 按天明细表、可选费用。严格只读，零埋点。

单会话统计（轮/步、tok/s、缓存命中、逐条消息用量）**宿主聊天界面自带**——本插件刻意不重复造；v2 的右侧栏 tab 与下钻接口因此删除。

- 数据源：`<DSH_HOME>/sessions/*/*/session.v3.jsonl.zstd`——**跨全部 workspace 的全局视图**，含子代理会话。
- 增量设计：会话文件是追加式多帧 zstd。字节级精确的帧 walker（RFC 8878 帧头/块头，不碰 LZ4）让扫描器按文件持久化折叠状态，后续只解压**新完成的帧**，未变文件零解压开销。状态落 `<DSH_HOME>/cache/usage-stats.folds.json`（tmp+rename 原子写；状态损坏或缺失自动整文件重扫）。
- 形态：服务端注册 `usageStats` Typert Remote（**单只读方法 `overview(filter)`**）与 `usage-stats` settings 命名空间（价目表持久化）；浏览器半是手写 `__ModuleLoader__` 工厂（`lib/client.js`，无构建链），自挂 remote descriptor 并注入 `settings.section` 页面。

## 安装

```sh
dsh plugin --profile <your-profile> add dsh-plugin-usage-stats
```

然后**重启该 profile 的 host**（新挂载的包不会热加载）。刷新 Web GUI → 设置 → 通用侧栏 → **Token 用量**。

- **日期范围**：单触发按钮（不是两个原生输入框），弹层内含预设快捷键 + 月历任意范围选择（本地时区、按天粒度）。点「全部」清空窗口。
- **过滤**：服务商、模型两个下拉（选项池来自最近一次无过滤扫描；选中服务商后模型列表随之收窄）。维度过滤生效时消息计数 KPI 自动隐藏——消息行不携带模型归因，没有诚实的数字可显示。
- **报表**：会话数 / 总 token / 未缓存输入 / 输出 / 缓存读（含命中率）/ 缓存写，随后按模型、按天两张明细表（配价后每行带费用），底部只读价目摘要（编辑走 settings.yaml，见下）。刻意轻量——不做价目编辑表单。

## 口径

- `inputTokens` = **未缓存输入**（`total = input + output + cacheRead + cacheWrite`，真实数据已核实）。
- 命中率 = `cacheRead / (cacheRead + 未缓存输入)`；`cacheWrite` 单列报告、不参与比率。
- 从不上报缓存字段的 provider，命中率显示“—”（绝不给误导性的 0%）。
- 重试折叠：同一 `(session, turn, step)` scope 只保留末条 usage 样本——这也让增量重放天然幂等。
- 费用：未配价的模型只报 token 不报钱。
- 消息计数：`userMessages` 数 `user/message` 行、`assistantMessages` 数 `assistant/message` 行（含无 usage 的）、`toolCalls` 数 `tool/call` 行——逐行 O(1) 顺带计数、不去重。overview 对窗口内有 usage 事实的会话按文件去重求和；带模型/服务商过滤时返回 `null`。
- `overview(filter)` 接受 `{ from?, to?, model?, provider? }`——日期 `YYYY-MM-DD`（本地时区，起止倒挂自动交换），`model` 与价目同规则（`"provider/model"` 全键精确优先、裸模型名兜底），`provider` 匹配服务商段。非法键直接丢弃、不做猜测。

## 价目表（元 / 百万 token）

两层，遵循宿主 settings 语义：**patch base（部署默认）→ 用户 settings 层覆盖**——热生效、免重启。

1. **用户层（推荐）**：`~/.dsh/settings.yaml` 里的 `usage-stats` 命名空间（宿主设置页可打开）：

   ```yaml
   usage-stats:
     prices:
       "opencode-go/glm-5.3-flash": { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 }
       "some-lora-model": { input: 1 } # 缺省字段按 0
   ```

2. **部署 base**：profile patch 行的 `config.prices`（`dsh plugin` 写入的默认值）。
   注意：patch 行**整体替换目标行的 config**——写 patch 时所有键都要重述：

   ```yaml
   - id: usage-stats
     config:
       sessionsHome: "" # 空 = $DSH_HOME/sessions
       prices: {}
   ```

键支持 `"provider/model"`（精确优先）或裸 `"model"`（兜底）。值必须 ≥ 0（schema 拒绝负数）。

## 开发

以 pnpm `link:`（符号链接）挂进宿主 profile 时，改源码**免重装**：服务端改动重启 host 生效，`lib/client.js` 改动刷新页面即生效。`file:` 挂载则每次须在 profile 内 `pnpm install` 重同步拷贝。

`@deepseek-ai/schemastery` 依赖（settings schema）在 pnpm hoisted 布局下与宿主共享顶层副本——无跨副本 instanceof 风险。

## 测试

```sh
node --test tests/*.test.ts
```

fixture 口径测试（折叠、消息计数、维度过滤、价目折算、settings 接线）、用真 `zstd` CLI 产物对表的帧边界测试（无 CLI 自动 skip）、跨帧半行场景的「增量 === 全量重放」性质测试、持久化 store 重启复用测试，另有真实会话目录集成测试（无会话目录自动 skip）。

## 已知边界（v0.3）

- 增量解码依赖帧 walker 识别「完整帧」：文件尾半帧留待下次补齐；legacy/字典帧退化为整文件重扫（仍正确，只是慢）。
- 无 `zstd` CLI 时增量按帧喂 node:zlib；再失败则整库回退全量重解（结果正确）。
- 打开页面、手动刷新、改筛选时拉取；无服务端推送，也不自动轮询。
- 浏览器侧 `$mount` 手写 strict descriptor（结果 schema 透传）；方法/参数名（`overview(filter)`）与 `src/cordis.ts` 是隐式两端契约，改一端必同步另一端。
- 价目编辑仍在 settings.yaml 文档（数据层与热更新已就绪；编辑表单刻意不做）。
