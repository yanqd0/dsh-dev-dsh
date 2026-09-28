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
| 页面持久状态 | 侧边栏布局等仅存浏览器 | 只能请用户取：`localStorage` 的 `dsh.sidebar-right.v1.<sessionId>`（本次唯一缺口） |

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
5. **看错 effect 归属**。`slots.register` / `slots.inject` / `provideRoot` 的 effect 建在
   **slots 服务自己的 ctx（即 renderer 的 fiber）** 上，插件卸载后其 slot 贡献**仍存活**；
   而 resource provider 随注册它的插件卸载被删除。
   → 可以出现"面板还在、provider 全没"。判断生命周期以"这个 `ctx` 是谁的"为准，别按 JSDoc 想当然。
6. **重复探索**。把已证伪的假设写进记录；下一轮只查未证伪项。

## 五、未决项（转 skill 前的验收样例）

- 待判：上述两条消息属 ①**页签地址失效**（`contentId` 非 `dsh-resource://…`，`protocolOf()` 返回 undefined，
  定义上就是 `none`）还是 ②**provider 生命周期竞态**（服务重供导致注册被丢、且 `provideRoot` 遇重复 key 抛错后无法自愈）。
- 判别试验（各 10 秒，不需要 devtools）：关掉坏页签后从卡片 / 侧栏重新打开；再取该 session 的
  `localStorage` 布局，打印 `kind` 与 `contentId`。
- 进 skill 时的切分：§二/§三 → "诊断流程"分册；§四 → "反模式清单"；本用例 → 可复现验收样例。
