# 运行时故障的低成本定位法：先把现象变成状态，再谈机制

本文是 `references/dogfood/index.md` 的子页，回答「插件或页面行为不对时，按什么顺序查、哪些直觉是错的」。
证据在哪取见 `references/dogfood/runtime-evidence.md`；浏览器客户端层的探针见
`references/dogfood/client-console-diagnosis.md`。

上游事实出处：`deepseek-harness@dsh-v0.2.0-rc.2`（历史案例按发生时点的基准标注）。

## 1. 成本纪律（先立规矩）

- **不要先读大 bundle**。打包后的 `client.js` 常见几十 KB 到几百 KB，一次整读就是几千 token 且极易带偏。
  固定用上下文窗口抽取：`grep -o ".\{0,200\}<关键串>.\{0,300\}" <file> | head`；确认相关且 <10 KB 才整读。
- **一条判断对应一条可执行命令**：先做最便宜的证伪，不要连读三个文件才动手。
- **一次只证伪一个假设**，结论落成表：`假设 | 证据（命令输出） | 判定`。
- **先锁消息原文，再谈机制**：产品文案在 bundle 里是唯一字符串，反查一次就能定到文件与分支。
- **服务端日志默认不含客户端信息**：别在宿主日志里反复找浏览器状态（`runtime-evidence.md` §1）。
- **写死「已证伪」清单**（§6）：同一个假设查两遍是纯浪费。

## 2. 通用四步

1. **锁消息**：把用户看到的原文（含语言）当唯一 key，在 dsh 安装树里反查归属：

   ```bash
   D=<dsh 安装根>/node_modules/.pnpm        # 或 profile 的 node_modules
   grep -rl "<消息原文>" "$D" | head
   ```

   产出：归属插件 + 精细到行号的判定分支。

2. **读状态机**：确认这段文案等价于哪个**内部状态**。文案通常是内部状态的投影；投影关系一旦明确，
   「现象」就变成「某个字段的值」，后面每一步都可证伪。
3. **找写入方**：谁把这个状态置位 / 清除？注册表在哪、谁提供、生命周期归谁（effect 归属最容易看错，§4.5）。
4. **分层**：宿主 / 传输 / 浏览器运行时 / 页面持久状态，各有观测手段（§3）。

## 3. 分层观测

| 层           | 看什么                                              | 去哪取证                                          |
| ------------ | --------------------------------------------------- | ------------------------------------------------- |
| 宿主进程     | 启动告警、插件激活失败、patch 未命中                | `runtime-evidence.md` §2 / §3                     |
| 宿主图谱     | 实际挂载了哪些行、每行来自哪个 patch                | `runtime-evidence.md` §5（`--dump-config`）       |
| 客户端图谱   | 浏览器「将要加载什么」                              | `client-console-diagnosis.md`                     |
| 客户端产物   | 下发字节与磁盘是否同源（combo 的 rev ≠ 单文件 rev） | `client-console-diagnosis.md` §6                  |
| 传输         | 反代 / 鉴权 / 长连接                                | `runtime-evidence.md` §7                          |
| 页面持久状态 | 只存在浏览器里的布局、偏好                          | `client-console-diagnosis.md`（往往只能请用户取） |

## 4. 反模式清单（都踩过）

每条只写「症状 → 判据 → 正确做法」。

1. **过期日志冒充现状**：profile 下的插件自建日志（如 `.dsh-market/log.ndjson`）可能停在几周前。
   → 先看时间分布再看内容（`runtime-evidence.md` §8）。
2. **把 loopback 当万能嫌疑人**：预览类插件一处都不读 `isLoopback`，只有 settings 面读。
   → 先 `grep -rl isLoopback <安装树>` 拿到消费面，再决定要不要怀疑反代。
3. **等一份「更全的日志」**：客户端插件的加载与失败全在浏览器，宿主侧没有对应上报。
   → 要客户端状态就去浏览器取证。
4. **以为启动门禁能兜住运行期**：启动审计只在启动后跑一次，之后的 `failed` 状态被显式丢弃，也不报红字。
   →「当时能开」≠「运行期正常」；「控制台干净」≠「没出错」。
5. **看错 effect 归属**：`slots.register` / `resources.register` 的 effect 建在**调用者 fiber** 上
   （cordis 的 `Service` 把 `this.ctx` 做成调用者上下文代理，`vendor/cordis/src/service.ts`），
   所以「面板还在、provider 全没」这一组合不可达。→ 判断生命周期以「这个 `ctx` 是谁的」为准，
   并先确认 `this.ctx` 是不是调用者代理。
6. **把片段返回值当输出**：`Object.entries(x).filter(…).forEach(…)` 返回 `undefined`，
   `for…in undefined` 是空操作、不报错。→ 判「有没有」用 `Object.keys(x)`。
7. **重复探索**：把已证伪的假设写进 §6 清单，下一轮只查未证伪项。
8. **把「仅浏览器里错」的解析当机制问题**：在必须正确解析字符串的地方依赖浏览器 `URL` 会吃平台差异
   （同一地址在 Node 与 Chromium 里解析出的字段不同）。→ 任何「只在页面里错」的解析都要两侧分别验；
   只用 Node 单测覆盖不到。
9. **手改安装树里的 bundle 来插桩**：pnpm store 常见硬链接，就地改写等于同时改了 store；把代码插进函数名与
   调用括号之间语法合法但语义已坏。→ 优先只读探针；非要改就先备份、插在两个完整语句之间、`node --check`
   **且**做语义自检、用完还原（纪律全文见 `client-console-diagnosis.md` §6）。

## 5. 验收样例（历史案例）

样本：计划预览报「计划预览不可用」、文件预览报「文件资源服务不可用」，同一浏览器里终端正常。

- 结论：客户端 `protocolOf()` 依赖浏览器 `URL` 的 `hostname`，而 Chromium 把 `dsh-resource://file/…`
  解析成 opaque（`hostname` 为空）⟹ 所有资源记录都是 `idle("none")`。
- 该案例发生时点的基准是 0.1.7-rc.2；现象 / 根因 / 修法与当时用到的探针见
  `references/dogfood/client-console-diagnosis.md`，仓外记录是 `notes/resource-preview-protocol-bug.md`。
- 被**证伪**过的假设（别重查）：页签地址形态失效；用 `Service.listService` 判服务存活（它是静态目录）；
  「面板 body 存活 + provider 全没」；重复安装 / 第二 provider；boot 后重挂载；服务回滚。

## 6. 「已证伪」清单模板

```markdown
假设：<一句话>
手法：<实际跑的命令>
结果：<关键输出>
判定：证伪 / 成立（成立则补根因与修法）
```

写在 issue body 或仓外笔记都行，关键是下一轮**只读清单就不重查**。

## 7. 与两个分册的分工

- `runtime-evidence.md`：证据在哪、怎么取（手段目录）。
- `client-console-diagnosis.md`：浏览器客户端层的探针、判定矩阵与插桩纪律（手段细节）。
- 本文：**顺序、判据与反模式**（什么时候用什么手段）。

三者共用一条纪律：先锁文案 / 状态，再谈机制；把已证伪项写下来。
