# DSH 运行时故障的低成本定位法

> 记录时点 2026-09-28。样本：一次「计划预览不可用 + 文件资源服务不可用」的定位（耗时约 2 小时、
> context 消耗明显偏高）。本文件只沉淀**方法**与**反模式**；那次的结论与未决项在 mint issue 里。
> 目标形态：未来作为 skill 的一个分册（诊断流程 + 反模式清单 + 可复现验收样例）。

## 一、成本纪律（先立规矩）

- **不要先读大 bundle**。`@deepseek-ai/dsh-client-*/lib/client.js` 常见 30 KB–500 KB，`cat`/`read`
  一次就是几千 token 且极易带偏。固定用上下文窗口抽取：
  `grep -o ".\{0,200\}<关键串>.\{0,300\}" <file> | head`。
  只有确认相关且 <10 KB 的文件才用 `read`。
- **一条判断对应一条可执行命令**。不要连读三个文件才动手；先做最便宜的证伪。
- **一次只证伪一个假设**，结论落成表格：`假设 | 证据（命令输出） | 判定`。
- **先锁消息原文，再谈机制**。产品文案在 bundle 里是唯一字符串，反查一次就能定到文件与分支。
- **服务端日志默认不含客户端信息**（见 §四.4）。不要在宿主日志里反复找浏览器状态。
- **写死"已证伪"清单**，下一轮不要重查（本次 dshmarket / 反代被查了两遍，纯浪费）。

## 二、通用四步

1. **锁消息**：把用户看到的原文（含语言）当唯一 key，在 dsh 安装树反查归属：
   ```bash
   D=<dsh 安装根>/node_modules/.pnpm        # 或 profile 的 node_modules
   grep -rl "<消息原文>" "$D" | head
   ```
   产出：归属插件 + 精细到行号的判定分支。
2. **读状态机**：确认该文案等价于哪个**内部状态**。文案通常是内部状态的投影；投影关系一旦明确，
   "现象"就变成"某个对象字段的值"，后续全部可证伪。
3. **找写入方**：谁把这个状态置位/清除？注册表在哪、谁提供、生命周期归谁（`ctx.effect` 的归属最容易看错，见 §四.5）。
4. **分层**：宿主 / 传输 / 浏览器运行时 / 页面持久状态，四层各有观测手段（§三）。

## 三、四层观测手段（可复制）

| 层 | 要看什么 | 手段 |
| --- | --- | --- |
| 宿主进程 | 启动告警、插件激活失败 | 启动日志（本机：`~/scripts/dsh/dsh.log`，`run.sh` 用 `>>LOG 2>&1`）；关键串 `entries did not activate` / `skipping profile bundle` |
| 宿主图谱 | 实际挂载了哪些 row | `dsh --profile <p> --dump-config`（会重写 profile 的 `cordis.yml`，沙箱下要提权）；无权限时按 `package.json` 的 `dsh.profile.bundles` + 各 bundle 的 `cordis.patch.yml` 静态推算 |
| 客户端图谱 | 浏览器"将要加载什么" | 带 cookie GET `/`，解析 `globalThis["__DSH_BOOT__"]`；或连 SSE `/plugins/events`（连上即发一帧 `{"type":"graph"}`） |
| 客户端产物 | 下发内容与磁盘是否同源 | 拉 `plugins/??<id>/client.js&rev=<rev>` 与安装目录 `diff`（忽略 `sourceMappingURL`） |
| 传输 | 反代 / 鉴权 / 长连接 | token 换 cookie 后 GET `/` 应 200；`remote.mux` WebSocket 直连 vs 经反代各开一条比稳定性（`ws` 包在 dsh 安装树内，可用 `createRequire` 加载） |
| 页面持久状态 | 侧边栏布局等仅存浏览器 | 只能请用户取：`localStorage` 的 `dsh.sidebar-right.v1.<sessionId>`（本次唯一缺口）                                                                                               |

## 四、反模式清单（本次踩过的坑）

1. **过期日志冒充现状**。`~/.dsh/profiles/web/.dsh-market/log.ndjson` 有 460 条 `hot-mount`，但最后一次
   `boot` 是 9/13，且 dshmarket 已不在 `dsh.profile.bundles`。
   → 先看事件/时间分布：`grep -o '"at":"[0-9-]*' log.ndjson | sort | uniq -c`，再看内容。
2. **把 loopback 当万能嫌疑人**。`isLoopback` 的消费点只有 settings 面（`dsh-client-ui-settings`、
   `...-settings-general`、api-gateway 的 `$host`）；预览类插件一处都不读。
   → 先 `grep -rl isLoopback <安装树>` 拿到消费面，再决定是否怀疑反代 / `patch-lan.sh`。
3. **等一个"更全的日志"**。客户端插件加载与失败全在浏览器；`dsh-client-modules` 不上报宿主
   （shell 里没有任何诊断上报请求）。
4. **以为启动门禁能兜住运行期**。shell 的启动门禁只在启动后检查一次（任一 entry 非 ACTIVE 即抛
   `web boot: N entries did not activate`，并停在启动页）；而**启动后的 `failed` 状态被显式丢弃**
   （`(container === undefined || state !== "failed") && page.setState(...)`）。
   → "当时能开"≠"运行期正常"，且运行期失败**不报红字**：不能拿"控制台干净"当"没出错"。
5. **看错 effect 归属**（本条曾在 2026-09-28 被写反，2026-09-28 深夜用真实产物复现纠正）。
   `slots.register` / `slots.inject` / `slots.provideRoot` 与 `resources.register` 的 effect
   都归**调用者 fiber**：cordis 的 `Service` 把 `this.ctx` 做成**调用者上下文代理**
   （`utils.ts` 的 `createTraceable` + `tracker.property === 'ctx'`），所以 JSDoc 里
   "returns disposer owned by the caller's Cordis fiber" 与实现一致。
   → 插件的 slot 贡献与 resource provider **同生共死**，不存在"面板还在、provider 全没"。
   判断生命周期以"这个 `ctx` 是谁的"为准；但**别只看 `this.ctx` 字面**，要先确认
   `this.ctx` 是不是调用者代理。可用真实 cordis + 真实 `dsh-client-resources` 产物写个只读脚本复现。
6. **把"无报错"当"没出错"**。客户端 fiber 失败只写 `ctx.logger.error`；启动后的 `failed` 状态不进任何 UI
   失败列表（`onEntryState` 显式丢弃），而那个列表所在的设置页还可能根本没挂载。
   → 要更硬的证据，用 §六.5 的客户端探针。
7. **把片段返回值当输出**。`Object.entries(localStorage).filter(...).forEach(...)` 返回 `undefined`，
   且 `for…in undefined` 是空操作、不报错；要判"到底有没有 key"就直接 `Object.keys(localStorage)`。
8. **重复探索**。把已证伪的假设写进记录；下一轮只查未证伪项。
9. **把"仅浏览器里错"的解析当"机制问题"**（这才是 2026-09-29 那次的真正根因）。
   在必须正确解析字符串的地方依赖浏览器 `URL` 会吃平台差异：Chromium 对
   `dsh-resource://file/…` 给 `hostname === ""`（`file` 是特殊 scheme 名，整段变 opaque），
   Node 给 `"file"`。⟹ **任何"只在页面里错"的解析，都要在浏览器里再验一次**；
   只用 Node 单测覆盖不到，而这正是"0.1.7 也坏、无痕也坏、刷新立刻坏、控制台无报错"的原因。
   取证手段与判定矩阵见 [client-console-diagnosis.md](client-console-diagnosis.md)。
10. **手改安装树里的 bundle 来插桩**。本轮踩过两次：①把探针插进 `f(...)` 的 `f` 与 `(...)`
    之间（`setTotal` 不再被调用 ⟹ 整页白屏）；②pnpm store 是**硬链接**，就地改写等于同时改了
    store 内容。⟹ 优先只读探针；非要改就先备份、插在两个完整语句之间、改完 `node --check`、用完还原。

## 五、验收样例（本样本已结案）

样本：计划预览「计划预览不可用」+ 文件预览「文件资源服务不可用」，同一浏览器、终端正常。
文案已锁死：前者 = `PlanPreview` 的 `resource.status === "none"`；后者 = `TextPreview` 的 `canRead = false`。
**结论：客户端 `protocolOf()` 依赖浏览器 `URL` 的 hostname，而 Chromium 把
`dsh-resource://file/…` 解析成 opaque（hostname 为空）⟹ 所有资源记录都是 `idle("none")`。**
完整现象/根因/修法：[resource-preview-protocol-bug.md](resource-preview-protocol-bug.md)。

定位途中被**证伪**的假设（下次不要再查）：

- 页签地址失效：`protocolOf("dsh-resource://plan/…"/"…/file/…")` 地址形态正常。
- 探针口径：客户端 `Service.listService` 是**静态目录**，`resources` 缺席**不能**推出"服务已消失"。
- "面板 body 存活 + provider 全没"：effect 归调用者 fiber（§六.3），该组合不可达。
- 重复安装 / 第二 provider：全树只有一处 `provide("resources")`，每个 client 插件只有一个版本。
- boot 后重挂载：SSE `/plugins/events` 实测 25 秒内只有 1 帧 `graph`，rev 与页面 `__DSH_BOOT__` 完全一致。
- 服务回滚：实测注册表里 `providers` 有 `file`/`plan`，`providerOf('file')` 为 PRESENT；
  但 `records` 里每条记录的 `protocol` 都是 `undefined`，`recordsOf('file')` 为 0。

进 skill 时的切分：§二/§三 → "诊断流程"；§四 → "反模式清单"；客户端层取证 →
`skill/references/client-console-diagnosis.md`（已落地）；本用例 → 可复现验收样例。

## 六、本次验证有效的补充手段

1. **用启动门禁反推"启动时状态"**。`GS()`（`web boot: N entries did not activate`）只在启动后跑一次，
   之后的 `failed` 被丢弃。⟹「界面能开」只证明**启动那一刻**所有客户端 entry 都 ACTIVE；
   反过来可断言"provider 当时确实注册过"，把故障限定在**启动之后**。
2. **排除"启动重建"**。`ClientEntries.start()` 会写 `revisions`，`sync()` 只在 `entryTargets` 变化时 `generation++`。
   ⟹ 首次 SSE `graph` 与页面 `__DSH_BOOT__` 一致时是**空操作**（本次据此排除该嫌疑）。
3. **effect 归属速查**（判断"谁随谁死"）。`slots.register` / `slots.inject` / `slots.provideRoot`
   与 `resources.register` 的 effect 都建在**调用者 fiber** 上（`service.ctx` 是调用者上下文代理）。
   ⟹ 注册方插件一旦 pending/failed/卸载，它的 **slot 贡献与 resource provider 一起消失**；
   "面板 body 存活 + provider 全没"这一组合**不可达**，不要再据此推断。
   复现：用真实 cordis + 真实 client-resources 产物跑只读脚本即可（本机验过，脚本未入库）。
4. **列出客户端服务提供者**：`grep -o 'provide("[a-zA-Z.]*"' <每个 client.js>`。注意 `Service` 基类提供的服务
   （`slots`、`remote`、`remote.*`、`configForms` 等）grep 不到，要看 `class … extends Service` / `super(ctx, "name")`。
   异步 apply 会分批挂子插件（`api-remotes` 里 24 次 `$mount` → `createNamespace` → `ownerCtx.plugin`），
   ⟹ 客户端服务图在 boot 之后仍在"落定"，这是"boot 后重激活"的天然窗口。
5. **别把探针的静态目录当运行期状态**。客户端 `Service.listService` / `Event.listEvents` 用的是打包进
   runner 的**静态目录** `SERVICE_API` / `EVENT_API`（`queryServiceApi(key, services = SERVICE_API)`），
   只覆盖有类型声明的服务；**某服务不在目录里 ≠ 该服务不在运行**。
   客户端真正读实时状态的只有 `Slots.listSubTree`（走 `ctx.get("slots").snapshot()`）、
   `Theme.listTokens`。要判"某个服务是否活着"，只有这两个探针够用。

6. **产品自带客户端探针（打不开 devtools 时的首选，但要知道边界）**。`dsh-cordis-client-runner`
   的 `clientInspectProviders` 暴露 `Service` / `Event` / `Builtin` / `Slots` / `Theme` 五类，
   经 `syncInspectManifest` 上报宿主；在 **Creator（cordis 预设）**会话里用
   `cordis_inspect_list` + `cordis_inspect_query` 即可读客户端状态。**能读什么、不能读什么**：
   - `Slots.listSubTree` 与 `Theme.listTokens` 走**实时**服务（`ctx.get("slots"|"theme")`），可信；
   - `Service.listService` / `Event.listEvents` 走**静态目录**（见 §六.5），**不能**用来判服务存活；
   - 该 runner 还注册了 `cordis_inspect_self`（宿主侧），以及客户端动态插件工具
     `cordis_define` / `cordis_run` / `cordis_stop` / `cordis_undefine`——后者能把只读查询跑进
     浏览器受限 `ctx`（`Builtin.ctx.get(name)` 对**未声明**的服务也返回其存在性），
     是唯一能直接问"`resources` 服务在不在"的手段，但**不在所有会话的工具表里**，用前先看工具表。
7. **把"地址 vs provider"当构建期问题先证伪**：`git log -S"openTab(" -- <相关包路径>` + 查该类型是否有 guide entry
   （只有 guide 条目才会被 `openTab(kind)` 开成 page 型页签）——比反复请用户看 UI 便宜得多。
   更进一步：纯函数（`protocolOf` / `planAddress` / `parsePlanAddress`）可以直接从 bundle 源码里截出来
   在 node 里跑，几秒就能证伪"地址形态变了"这条假设。
