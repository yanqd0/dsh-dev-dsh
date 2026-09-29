# 客户端运行时取证法：在浏览器 Console 里读活状态

> 记录时点 2026-09-29。方法在做一次客户端 bug 定位时定型（案例见
> [resource-preview-protocol-bug.md](resource-preview-protocol-bug.md)）。
> 本文是仓内方法记录；同内容已整理为 skill 分册 `skill/references/client-console-diagnosis.md`。
> 宿主/传输/部署层的定位法见 [runtime-triage.md](runtime-triage.md)。

## 一、适用面

服务端日志干净、终端正常，但**页面某处**不对；现象只在真实浏览器里成立（解析器差异、
DOM、React 时序）；或拿不到 devtools 断点、不能改安装树。前置：用户能打开页面 Console。

优先顺序固定为：**Console 只读探针 > 框架既有机制（如动态客户端插件） > 改 bundle**。

## 二、四步骨架

1. **锁文案 → 定状态**：把用户看到的原文当唯一 key，在安装树 bundle 里反查，得到它等价于
   哪个内部状态。例：`resourceUnavailable` ⟺ `useResource(x).status === "none"`
   ⟺ `providerOf(protocolOf(address)) === undefined`。先把"现象"变成"某个字段的值"。
2. **拿活对象**：从 DOM 的 React fiber 树取组件 props / hook 值（§三）。
3. **只读判定**：读 `ctx.get(name)`、读 fiber 上已渲染的值；不要调 hook（React #321）、
   不要触发副作用。探针必须**永不抛**（每个字段访问都 `try/catch`）。
4. **最小干预实验**：在可逆前提下动一下（如给记录补上正确字段再 `attach()`），看状态是否
   按预期翻转。翻转 ⟹ 根因确认。

## 三、从 React fiber 取活数据

- 入口：`document.getElementById('root')` 上的 React 私有 key（`__reactFiber$*` /
  `__reactContainer$*`），DFS 遍历 `child` / `sibling`。
- `memoizedProps` 里挂着框架下发的所有 hook 与服务（本案例里 `useResource`、`useTabInfo`、
  `renderSlot` 都能在 `AppFrame` / `TextPreview` 这类组件上直接拿到）。
- **`memoizedState` 就是该 hook 这次渲染返回的值**。案例里 `TextPreview` 第 13 个 hook
  就是 `{status:"none", value:undefined, failure:undefined}`——直接读出来，胜过任何推测。
- hook 不能在 React 外调用（`useResource('x')` → React #321）；要"问"值就读别人渲染出的那份。
- 在 cordis ctx 的 proxy 上读未注入属性会抛 `cannot get property "x" without inject`——
  那是保护，不是故障。用 `ctx.get(name)`（永远允许），并 `try/catch` 包住一切。
- 探针要**二分判据**，不要"看着像"。案例用的判定矩阵：

| 观测                                      | 结论                            |
| ----------------------------------------- | ------------------------------- |
| `ctx.get('resources') === undefined`      | 服务被回滚（贡献者 fiber 失败） |
| 服务在、`providers` 缺该协议              | 注册从未发生或注册方被卸载      |
| 服务在、provider 在、记录 `status:"none"` | **不是注册问题**，是解析/取值链 |
| 服务在、provider 在、记录 `status:"live"` | 消费者侧问题                    |

第三行是本案转折点：它把注意力从"provider 丢失"扭到"浏览器 URL 解析差异"。

## 四、反模式（本轮都踩过）

1. **手改安装树 bundle 插桩**，尤其把探针插进 `f(...)` 的 `f` 与 `(...)` 之间——
   语法能过、语义已坏（`setTotal` 不再被调用）⟹ 整页白屏。
2. **把"探针没找到"当"不存在"**。`Service.listService` 读的是**静态目录**
   （打包进 runner 的 `SERVICE_API`），某服务不在目录里 ⟹ 无信息量。
3. **在必须正确解析字符串的地方依赖浏览器 `URL`**：Chromium 对
   `dsh-resource://file/…` 给 `hostname === ""`，Node 给 `"file"`。任何"仅浏览器里错"的
   解析都要两侧分别验；只用 Node 单测覆盖不到。
4. **把 hook 当普通函数调**（#321）、**读 ctx 上未注入的属性**（抛错打断探针）。
5. **忽略混合内容**：HTTPS 页面里 `fetch('http://…')` 会被拦（Mixed Content）。
   回传走同源或 HTTPS，否则只能靠用户把 Console 输出贴回来。
6. **一次问太多**：探针越大越易被一个 `undefined` 打断。按判定矩阵分次问，每次一个问题。

## 五、插桩纪律（必须改 bundle 时）

- 先备份，文件名可识别（`*.orig` / `*.before-<用途>`），并知道如何还原。
- 插入点选在**两个完整语句之间**；**替换按整行/整语句做**，不要只替换表达式片段
  （残留的行首 `return` 会和新语句拼成 `return return …`）。
- **别把注释插在 `return` 与表达式之间**：`return /* 注释 */` 加换行会被 ASI 截断成
  `return;`——语法合法、函数恒返回 `undefined`（"补丁在、行为没变"，最容易被误判成修好了）。
- 因此：`node --check` 只做语法自检是**不够的**，必须做**语义自检**——把改过的函数从文件里
  截出来（括号配平），`new Function(src + '; return fn')()` 求值，喂样例断言返回值；
  不过就当场回滚。幂等判据也要带语义（只看标记会把坏补丁当成已完成，永远不修）。
- 确认"服务器下发字节 == 磁盘字节"。很多实现按**内容哈希**生成下发 rev：改完 rev 会变，
  旧 URL 直接 404——这是正常的。客户端 bundle 常走 **combo 端点**（一次合并下发几十个
  `client.js`），它的 rev 与单文件 URL 的 **不同**，两条路径都要验。
- pnpm store 常有**硬链接**：就地改写等于同时改了 store 内容（多份安装共享同一 inode），
  做副本/还原时要有意识。
- 验证完**立刻还原**，并把"下次优先只读探针"写进结论。

> 本轮同类坑踩了三次：① 插进 `f(...)` 的 `f` 与 `(...)` 之间 → 整页白屏；
> ② 注释插在 `return` 与表达式之间 → ASI 截断，补丁"看着在、跑起来没用"；
> ③ 漏掉行首 `return` → `return return`。三次都语法合法或接近合法。

## 六、可复现的辅助手段（本轮验证有效）

- **用真实产物做 Node 复现**验证生命周期归属，而不是靠 JSDoc：写个只读脚本 import 真实 cordis 4.0.4
  - 真实 `dsh-client-resources` 产物即可（本机跑过一次；脚本属临时件，未入库）。
- **从 bundle 里截纯函数源码在 Node 里跑**，用来证伪"地址形态变了"这类假设；
  但记住 Node 与浏览器 `URL` 可能不同（本轮正是栽在这里，反而成为根因线索）。
- **对比 SSR/无痕/另一版本**：本案"0.1.7 也坏、无痕也坏、刷新立刻坏"说明是**确定性**问题，
  排除时序与缓存类假设。

## 七、环境与工具坑（本轮实际踩到）

- **沙箱会拦住工作区外的写**：`workspace-write` 下 `cp`/`perl -i` 到 `~/.nvm/...` 直接
  `Permission denied`——即便文件属主可写。要么请用户执行那一条命令，要么由用户显式授全权。
- **pnpm store 硬链接**：安装树里的 `client.js` 常与 `~/.pnpm/store/...` 同一 inode，
  就地改写等于同时改了 store 内容；`cp` 出的 `.orig` 也会占用同一 inode 的旧内容，
  所以"备份 → 改 → 还原"必须用**写文件**语义（`cp -f` 覆盖），不要用 in-place 追加。
- **下发 rev 是内容哈希**：改完 bundle 后 boot 里的 `rev` 会变，旧 `rev` 的 URL 直接 404——
  这是补丁生效的证据，不是故障。取证时要用**新的** `rev` 去取。
- **HTTPS 页面的 Mixed Content**：`fetch('http://<LAN-IP>:3099/...')` 会被浏览器拦，
  跨源回传只能走同源路径或 HTTPS；最稳的回收方式是让用户**粘贴 Console 输出**。
- **动态客户端插件工具不总是可用**：`cordis_define` / `cordis_run` 由
  `@deepseek-ai/dsh-cordis-client-runner` 提供，但该条目要在 profile 里挂载、工具还要在会话
  工具表里（本机当时 `absent`）。用前先查：`cordis_inspect_list` 有没有客户端 provider、
  当前会话工具表有没有这几个工具。
- **mint 可能整体不可用**：本轮遇到宿主 `mint` 报 `Cannot find module 'mint-faa/run-mint.js'`、
  CLI 报 `SQLite error: attempt to write a readonly database`——issue 记录会被阻塞，
  定位工作要继续，但"落 issue"要等工具恢复。

## 八、下一步（已在 mint 立项）

把本方法自动化到什么程度最划算，见 milestone `0.2.0` 的 plan「评估『客户端 Console
只读探针』定位法的自动化」：候选方向与验收标准写在该 plan 的 body 里。
