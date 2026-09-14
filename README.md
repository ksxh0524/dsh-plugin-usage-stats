# dsh-plugin-usage-stats

DSH Web GUI 用量统计插件：全局模型 token 用量（输入/输出/缓存读/缓存写、命中率）与按价目表折算费用，纯只读、零埋点。

- 数据源：`<DSH_HOME>/sessions/*/*/session.v3.jsonl.zstd`（**所有 workspace 的全局视图**，含子代理会话标记）。
- 形态：服务端注册 `usageStats` Remote（`overview` / `drillSessions` 两个只读方法）+ `usage-stats` settings 命名空间（价目表持久化）；浏览器半手写 `__ModuleLoader__` 工厂（`lib/client.js`，无构建链），在右侧栏注册「用量」tab。

## 安装

```sh
dsh plugin --profile <你的profile> add dsh-plugin-usage-stats
```

装完**重启该 profile 的 host**（新挂包不在热重载范围）。刷新 Web GUI → 右侧栏 guide 页 → 「用量统计」胶囊 → 以 tab 打开。

面板内：时间范围（今天/7 天/30 天/全部）、KPI 卡、按天柱状、按模型表（点行筛选会话下钻）、会话列表（分页）。

## 口径

- `inputTokens` = **未缓存输入**（`total = input + output + cacheRead + cacheWrite`，已在真实数据核实）。
- 命中率 = `cacheRead / (cacheRead + 未缓存输入)`；`cacheWrite` 单列不参与比率。
- Provider 未上报缓存字段时命中率显示「—」（不误报 0%）。
- 重试折叠：同一 `(session, turn, step)` scope 只保留末条 usage 样本。
- 费用：未配置价目的模型只报 token 不报钱。

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

fixture 口径测试 + settings 接线测试 + 真实会话目录集成测试（无会话目录自动 skip）。

## 已知边界（v0.1）

- 会话文件为多帧 zstd 追加流：解码走 `zstd -dc` CLI（缺省回退 node:zlib 单帧解码，可能漏后帧）。
- 文件级缓存按 `mtime+size`；同文件内只做「整文件重解」，无字节级尾部增量。
- 面板打开时拉取 + 手动刷新，无服务端推送。
- 浏览器侧 `$mount` 手写 strict descriptor（结果 schema 透传），两端方法/参数名（`overview(filter)` / `drillSessions(query)`）是隐式契约，改名须同步 `lib/client.js`。
- 价目设置卡片的 GUI 编辑（设置页卡片）未接：当前用户层经 settings.yaml 文档编辑；数据结构与热生效链路已就绪。
