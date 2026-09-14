# dsh-plugin-usage-stats（中文版）

英文主文档见 [README.md](./README.md)。

DSH Web GUI 用量统计插件（v2）：**右侧栏「用量」tab = 当前会话**视图（消息数、四路 token、命中率、按模型、费用）；**「设置 → 插件 → 插件配置」卡 = 全局报表**（与会话无关，支持今天/7 天/30 天/全部/选某天筛选）。纯只读、零埋点。

- 数据源：`<DSH_HOME>/sessions/*/*/session.v3.jsonl.zstd`（**所有 workspace 的全局视图**，含子代理会话标记）。
- 形态：服务端注册 `usageStats` Remote（`overview` / `drillSessions` / `sessionUsage` 三个只读方法）+ `usage-stats` settings 命名空间（价目表持久化）；浏览器半手写 `__ModuleLoader__` 工厂（`lib/client.js`，无构建链）。面板的当前会话 id 取 `sidebar.right.pane.tab` slot 的 session-scope 标准 prop（官方 sidebar-files 同款取法），切会话自动重载。

## 安装

```sh
dsh plugin --profile <你的profile> add dsh-plugin-usage-stats
```

装完**重启该 profile 的 host**（新挂包不在热重载范围）。刷新 Web GUI → 右侧栏 guide 页 → 「用量统计」胶囊 → 以 tab 打开。

- **面板（当前会话）**：会话标题/短 id/cwd/子代理徽标 + 用户消息 / Agent 消息 / 工具调用 / 请求步数 + 总输入（未缓存）/ 输出 / 缓存读（含命中率）/ 缓存写 + 按模型小表 + 费用（有价目显示金额，无则「—」）+「刷新」（重扫会话文件；新会话未落盘时显示「未采集到该会话用量」）。
- **设置卡（全局报表）**：时间筛选 chips（今天/7 天/30 天/全部）+ 单日选择（本地时区）、会话数/消息数/四路 token/命中率/费用合计 KPI、按模型表、底部价目只读摘要（编辑走 settings.yaml，见下）。界面从简，不做价目表单。

## 口径

- `inputTokens` = **未缓存输入**（`total = input + output + cacheRead + cacheWrite`，已在真实数据核实）。
- 命中率 = `cacheRead / (cacheRead + 未缓存输入)`；`cacheWrite` 单列不参与比率。
- Provider 未上报缓存字段时命中率显示「—」（不误报 0%）。
- 重试折叠：同一 `(session, turn, step)` scope 只保留末条 usage 样本。
- 费用：未配置价目的模型只报 token 不报钱。
- 消息计数（v2）：`userMessages` = `user/message` 行数，`assistantMessages` = `assistant/message` 行数（无 usage 的也计），`toolCalls` = `tool/call` 行数——逐行顺带 O(1)、不去重。全局卡的消息数为「窗口内有 usage 事实的会话」的 meta 计数之和（按 meta 对象去重），与会话数同口径。
- `sessionUsage`：单会话聚合全部 usage 事实（不按日期筛）；会话未被扫到时返回 `null`（面板显示「未采集到该会话用量」，多为新会话尚未落盘）。

## 价目表（元 / 百万 token）

两层，宿主 settings 语义：**patch base（部署默认）→ 用户设置层覆盖，改后热生效、不重启**。

1. **用户层（推荐）**：`usage-stats` 命名空间持久化在 `~/.dsh/settings.yaml`（宿主「设置」可打开该文档）：

   ```yaml
   usage-stats:
     prices:
       "opencode-go/glm-5.3-flash": { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 }
       "some-lora-model": { input: 1 }        # 缺省字段自动按 0 补
   ```

2. **部署 base**：profile patch 行的 `config.prices`（`dsh plugin` 挂包时的默认值）。
   注意 patch **整体替换目标行 config**，写 patch 时所有键都要重述：

   ```yaml
   - id: usage-stats
     config:
       sessionsHome: ""          # 空 = $DSH_HOME/sessions
       prices: {}
   ```

键支持 `"provider/model"`（精确优先）或裸 `"model"`（兜底）。数值须 ≥ 0（schema 拒绝负数）。

## 开发

本包在宿主 profile 里以 pnpm `link:`（符号链接）挂载时，改源码后**无需重装依赖**：服务端代码改动重启 host 生效，`lib/client.js` 改动刷新页面即生效。若改用 `file:` 挂载则每次须回 profile `pnpm install` 同步拷贝。

依赖 `@deepseek-ai/schemastery`（settings schema）在 pnpm hoisted 布局下与宿主共用顶层拷贝，无 instanceof 风险。

## 测试

```sh
node --test tests/*.test.ts
```

fixture 口径测试（折叠、三计数、单会话聚合、价目折算、settings 接线）+ 真实会话目录集成测试（无会话目录自动 skip）。

## 已知边界（v0.2）

- 会话文件为多帧 zstd 追加流：解码走 `zstd -dc` CLI（缺省回退 node:zlib 单帧解码，可能漏后帧）。
- 文件级缓存按 `mtime+size`；同文件内只做「整文件重解」，无字节级尾部增量。
- 面板/卡片打开时拉取 + 手动刷新（及会话切换、时间筛选变化时重载），无服务端推送。
- 浏览器侧 `$mount` 手写 strict descriptor（结果 schema 透传），两端方法/参数名（`overview(filter)` / `drillSessions(query)` / `sessionUsage(query)`）是隐式契约，改名须同步 `lib/client.js`。
- 设置卡只读：展示全局报表与「N 个模型已配价」摘要；价目编辑仍走 settings.yaml 文档（数据层与热生效链路已就绪，编辑表单有意不做）。
