# AGENTS.md — dsh-plugin-usage-stats

## 项目目标

DSH（DeepSeek Harness）Web GUI 的用量统计插件：**本仓库即这个 npm 包本体**（独立 git 仓库、独立发布；本地放在 dsh-plugins 合集目录下与其他插件并列，但合集根不是本包的构建/检查入口）。产出形态 = 服务端 Cordis 插件（`src/*.ts`）+ 手写浏览器半（`lib/client.js`）。

## 技术栈与形态（非标准点，先记住再动手）

- **无构建链**：服务端 TS 由宿主以 Node 原生 type-strip 直载（`src/*.ts` 即产物）；浏览器半是手写 `window.__ModuleLoader__.load({id, factory})` CJS 工厂（格式对齐官方包：tab 缩进、只 require 基线模块表如 `react`，prettier 已配 override）。禁止引入 bundler/JSX/TS 编译步骤。
- **零依赖铁律（服务端）**：不得 `import` 宿主协议包（`@deepseek-ai/cordis`、`dsh-typert-protocol` 等）——pnpm 链挂载下会解析出第二副本，Service 原型链/instanceof 跨副本失效。Remote 标记按协议形态手搓（字符串键 prototype 属性 + `typertRemote` 字段），见 `src/cordis.ts` 头注释。唯一例外：`@deepseek-ai/schemastery`（纯数据 schema，无 instanceof 判定）。
- 发布纪律：`files` 白名单 = 运行所需（src/lib/tests/cordis.patch.yml/双语 README）；工具链文件（.husky、tsconfig、commitlint 等）不进发布物也不碍发布。

## 开工

1. `pnpm install`（装工具链 + `prepare` 激活 husky 钩子）。
2. `pnpm check`（format:check + typecheck + test）必须全绿才允许交付。
3. 读 README（口径/契约，**双语两份必须同步改**）与目标文件顶部注释再动代码。

## 常用命令

- `pnpm check` — 三道门一体：`prettier --check .` + `tsc --noEmit`（strict）+ `node --test`
- `pnpm format` — 全仓格式化（唯一风格入口）
- 快速单测：`node --test tests/*.test.ts`
- 发布产物核对：`pnpm pack --pack-destination /tmp/x && tar -tzf /tmp/x/*.tgz`

## 完成标准（三关，自主过闸，勿停下问用户要不要测试/提交）

1. **静态**：`pnpm check` 全绿。类型错误必须真修，禁止 `@ts-ignore`/无谓 `any` 压制；**测试里模拟宿主注入对象的桩**（ctx/settings provider）可宽断言 `any` 并注明是桩——被测的生产代码必须严格。remote 方法形参允许且应当带 `: unknown` 这类简单注解（见「宿主契约」，有测试兜底）。
2. **行为**：`node --test` 断言真实语义，禁止改断言凑绿。新增能力必须带 fixture 测试；涉真实数据链路的集成测试在无会话目录时走 skip 而不是删掉。
3. **交付**：Conventional Commits（钩子强制；scope 按改动文件路径推导，映射表在 `commitlint.config.cjs` 头注释）、main 直推；`npm publish` 属用户动作（需用户本机 `npm login`，agent 不代跑、不代登录）。

## 挂载与真机验证（本包的「预发环境」）

- 真实 DSH profile 以 `link:` 符号链接指回本仓库源码（如 `~/.dsh/profiles/web/node_modules/dsh-plugin-usage-stats`），改源码免重装。
- **服务端改动**：须重启对应 profile 的 host 才生效——**时机由用户定，agent 不得自行重启**（重启会掉当前会话；3080 端口的 host = web profile）。
- **浏览器半 `lib/client.js` 改动**：页面刷新即生效。
- 服务端逻辑一律用 `node --test` 先行验证，别把宿主重启当天花板调试器。

## 宿主契约备忘（全部实测过，别重新勘察，也别单方面破坏）

- 会话文件是**追加式多帧 zstd**：解码必须 `zstd -dc` CLI（`node:zlib` 只解首帧，v1 踩过坑）。
- typert **SRC 模式参数铁律**：网关 `methodParameterNames` 取运行时函数源码，括号内按「逗号切分 → trim → 纯标识符且唯一」解析——默认值/解构/rest 直接拒。Node type-strip 会把 `filter: unknown` 这类注解替换为**等长空白**，trim 后标识符仍在，故简单注解 wire-safe（含逗号的复杂注解慎用；改动后跑 `tests/cordis.test.ts` 的解析复刻用例兜底）。
- **两端改名必须同步**：`lib/client.js` 手写 `$mount` 的 descriptor（方法名+参数名）与 `src/cordis.ts` 的 SRC 标记/形参名是隐式契约，只改一端 = 线上 404/参数错位。
- 右侧栏 tab：`sidebar.right.pane.tab` 是 **session-scope keyed slot**，注册组件自动收到标准 prop（`sessionId`、`useSessions` 等）——取当前会话就靠它，别去挖 store 或造会话下拉（官方 sidebar-files 同款）。
- 设置页插件卡派发 = 「宿主已注册 settings 命名空间」∩「浏览器注册了 `settings.plugin.item` **同 key** 卡」，缺一隐身；slot key 必须 === settings 命名空间名（本包 = `usage-stats`）。
- `ctx.remote` 是 build 期固定能力集，不含第三方命名空间；浏览器半须自 `ctx.remote.$mount(CONTRIBUTION)`，inject 清单（package.json `dsh.client.inject`）里别指望宿主帮忙装。
- profile 依赖是 `link:` 符号链接（非拷贝）；`cordis.patch.yml` 的 patch 行**整体替换**目标 config——写 patch 时所有键都要重述。

## 基本规则

- **写代码前先读代码与文档**：README + 目标文件顶部注释 + 宿主源码（`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/` 下可直接读官方插件的 `lib/client.js` 实证行为）。结论以代码为据，不臆测；业务意图（用户要什么界面/口径）才问用户，技术方案自定且不罗列 ABC 让用户挑。
- **文件顶部必须有设计意图注释**（职责/关键 tradeoff/隐含约束），改了什么就同步更新，过时注释比没有更糟。
- **选最佳方案不留技术债**：改接口/方法名同步所有调用方与两端契约，不留兼容 TODO；测试用真实语义数据（fixture），不编造让测试变绿的数据。
- **每步单独提交推送**，别攒到最后一次性大提交。
- **不破坏他人工作区**：不 `reset --hard`/`checkout --`/`clean` 别人文件；不改用户 profile 配置、价目数据（settings.yaml）、版本发布字段（除非任务要求）。钩子失败不许 `--no-verify` 硬闯——那是 bug 或别人在改，先弄清。
- 临时产物（pack 的 tgz、调试导出）进 `/tmp`，不进仓库。
- 计划外发现（宿主新契约、坑）当场补进本文件「宿主契约备忘」——这份清单的价值在于不用二次踩。

## 已知易错点

- pnpm store 在本机可能被引到仓库内（`.pnpm-store/`），已 gitignore，别提交。
- 本包在 dsh-plugins 合集目录下：合集根若有工具链/钩子与本包冲突，一切以本包（独立 git 仓库根）为准。
- prettier 对 `lib/**/*.js` 有 tab 缩进 override（对齐官方 loader 格式），别去掉。
- `pnpm test` 会真实扫 `~/.dsh/sessions`：本机首次扫约 1-2s，别在测试里假设空目录。
- 双语 README：改英文必同步中文，反之亦然。

## 文档

- `README.md`（英文，npm 默认）+ `README.zh.md`（中文），**双语必须同步改**。
- 宿主实现可读（只读！）：`/Users/liuyang/.npm-global/lib/node_modules/@deepseek-ai/dsh/`。
