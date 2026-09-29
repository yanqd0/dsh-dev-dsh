# 客户端运行时取证：在浏览器 Console 里读活状态

本文是 `references/dogfood/index.md` 的子页，回答「浏览器端行为不对时，怎么不靠 devtools 断点、不重编译、
不手改安装树，就把**运行中的真实状态**读出来」。方法在做一次客户端 bug 定位时定型；
那次的完整案例见仓外 `notes/resource-preview-protocol-bug.md`。

上游事实出处：快照 `deepseek-harness@dsh-v0.1.7-rc.2`，行号由 `src/facts.test.ts` 复核。

## 1. 何时用

- 服务端日志干净、终端正常，但**页面某处**行为不对（预览/面板/按钮）。
- 现象**不可复现于单测**：只出现在真实浏览器里（解析器差异、DOM、React 时序）。
- 拿不到 devtools 断点，或断点代价高（要重现用户操作）。
- 你**不能**改安装树（改了正在跑的服务 = 可能白屏；见 §6）。

前置：用户能在页面上打开 Console（本机局域网方案下就是浏览器 F12 / Cmd+Opt+J）。

## 2. 四步骨架

每次定位都是同一套流程，成本从低到高：

1. **锁文案 → 定状态**：把用户看到的原文（含语言）当唯一 key，在安装树的 bundle 里反查，
   得到「它等价于哪个内部状态」。例：`resourceUnavailable` ⟺ `useResource(x).status === "none"`
   ⟺ `providerOf(protocolOf(address)) === undefined`。**先把"现象"变成"某个字段的值"**，
   后面每一步都可证伪。
2. **拿活对象**：从 DOM 的 React fiber 树上取组件 props（§3）。多数框架级 hook/服务
   通过 props 下发（`useResource`、`useTabInfo`、`useStore`…），这一步通常一次成功。
3. **只读判定**：优先用**不可变**读法（读 `ctx.get(name)`、读 fiber 上已渲染的值），
   不要调用 hook（React #321）、不要触发副作用。
4. **做最小干预实验**：在**受控且可逆**的前提下动一下（如给一条记录补上正确字段再 `attach()`），
   看状态是否如预期翻转。翻转 ⟹ 根因确认；不翻转 ⟹ 假设错。

## 3. 关键技术：从 React fiber 上取活数据

页面上没有全局 `ctx` 时，`document.getElementById('root')` 的 React 私有 key
（`__reactFiber$*` / `__reactContainer$*`）是入口。要点：

- **遍历**：从 root fiber 出发 DFS（`child` / `sibling`），对每个节点看 `memoizedProps`
  与 `memoizedState`（hook 链，沿 `.next` 走）。
- **取组件 props**：`props` 里挂着框架下发的全部 hook 与服务（本用例里 `useResource`、
  `useTabInfo`、`renderSlot` 都能在 `AppFrame`/`TextPreview` 这类组件上直接拿到）。
- **读已渲染的值**：hook 的 `memoizedState` 就是它这次渲染返回的值。本用例里
  `TextPreview` 的第 13 个 hook 就是 `{status:"none", value:undefined, failure:undefined}`——
  **比猜机制便宜一万倍**。
- **hook 不能在 React 外调用**：`useResource('x')` 会抛 React #321（invalid hook call）。
  要"问"一个值就去读别人渲染出来的那份，别自己调。
- **别读不存在的字段**：在 cordis ctx 的 proxy 上读未注入的服务属性会抛
  `cannot get property "x" without inject`——这不是故障，是**保护**。用 `ctx.get(name)`
  （`get` 永远允许），并用 `try/catch` 包住任何字段访问，让探针**永不抛**。

## 4. 服务探针的固定套路

```js
(() => {
  // 用 try/catch 收集 ctx（遍历中一旦摸到就收下，之后只用 ctx.get）
  const isCtx = (v) => {
    try {
      return v && typeof v.get === 'function' && typeof v.provide === 'function' && v.fiber;
    } catch {
      return false;
    }
  };
  // …DFS root fiber，visit(memoizedProps) / visit(memoizedState)，命中 isCtx 就 push…
  const reg = ctxs
    .map((c) => {
      try {
        return c.get('resources');
      } catch {
        return undefined;
      }
    })
    .find(Boolean);
  return { providers: reg && [...reg.providers.keys()] }; // 只读，不改运行时
})();
```

判据设计要**二分**，不要"看着像"。本用例的判定矩阵：

| 观测                                      | 结论                            |
| ----------------------------------------- | ------------------------------- |
| `ctx.get('resources') === undefined`      | 服务被回滚（贡献者 fiber 失败） |
| 服务在、`providers` 缺该协议              | 注册从未发生或注册方被卸载      |
| 服务在、provider 在、记录 `status:"none"` | **不是注册问题**，是解析/取值链 |
| 服务在、provider 在、记录 `status:"live"` | 消费者侧问题                    |

第四行那次把注意力从"provider 丢失"扭到了"解析器差异"，是本案的转折点。

## 5. 反模式（都踩过）

1. **手改安装树里的 bundle 来插桩**——尤其别把插桩塞进 `f(...)` 的 `f` 与 `(...)` 之间：
   语法能过、语义已坏（`setTotal` 不再被调用 ⟹ 整页白屏）。见 §6。
2. **把"探针没找到"当"不存在"**。先确认探针本身对：本用例里 `Service.listService` 读的是
   **静态目录**（打包进 runner 的 `SERVICE_API`），某服务不在目录里 ⟹ 无信息量，不是"服务没了"。
3. **在必须正确解析字符串的地方依赖浏览器 `URL`**。Chromium 对
   `dsh-resource://file/…` 给 `hostname === ""`（`file` 是特殊 scheme 名，整段变成 opaque），
   Node 却给 `hostname === "file"`。任何"仅在浏览器里错"的解析都要**两侧分别验**。
4. **把 hook 当普通函数调**（#321），或**读 ctx 上未注入的属性**（`without inject` 抛错）。
5. **忽略混合内容**：HTTPS 页面里 `fetch('http://…')` 会被拦（Mixed Content），
   回传通道要走同源或 HTTPS；否则只能靠用户把 Console 输出贴回来。
6. **一次塞太多**：探针越大越容易被一个 `undefined` 打断。按 §4 的判定矩阵分次问，
   每次只回答一个问题。

## 6. 插桩的纪律（要改 bundle 时）

优先顺序：**只读探针（Console） > 走框架既有机制（如动态客户端插件） > 改 bundle**。

真要继续往下定位而只能改 bundle 时：

- **先备份**，文件名可识别（`*.orig` / `*.before-<用途>`），并知道怎么还原；
- **插入点选在两个完整语句之间**，绝不要插进函数名与其调用括号之间；
- **替换按整行/整语句做**。只替换"表达式片段"会让残留的行首 `return` 与新语句拼成
  `return return …`；把注释插在 `return` 与表达式之间又会触发 ASI
  （`return /* … */` 加换行 ≡ `return;`）——**两者语法都合法**，`node --check` 一律通过；
- 所以必须做**语义自检**，而不只是语法自检：把改过的函数从文件里截出来（括号配平），
  用 `new Function(src + '; return fn')()` 求值，喂样例地址断言返回值
  （`dsh-resource://file/…` → `file`、`dsh-resource://plan/…` → `plan`、
  `sidebar://files` → `undefined`）。不过就**当场回滚**；
- **幂等判据也要带语义**：只看"标记在不在"会把历史坏补丁当成已完成，永远不修。
  标记 + 语义双判，语义不过就还原 `.orig` 再重打；
- 改完确认"服务器下发的字节 == 磁盘字节"。客户端 bundle 常走 **combo 端点**
  （一次合并下发几十个 `client.js`：`/plugins/??a/client.js,b/client.js&rev=…`），
  它的 `rev` 与单文件 URL 的 `rev` **不是同一个**——两条路径都要验；
- 记住 pnpm store 常见**硬链接**：就地改写等于同时改了 store 内容，多做一份副本会被牵连；
- 验证完**立刻还原**，并把"下次优先用只读探针"写进结论。

> 本案的教训（同类坑踩了三次，每次都"看着像好了"）：
> ① 插进 `this.page.setTotal` 与 `(…)` 之间 → 整页白屏；
> ② 说明注释插在 `return` 与表达式之间 → ASI 截断，函数恒返回 `undefined`
> （补丁标记在、行为没变，最容易被误判成"已修好"）；
> ③ 只替换表达式片段、漏掉行首 `return` → `return return …`。
> 三次都语法合法或接近合法 ⟹ 唯一可靠的护栏是**语义自检 + 幂等时复验语义**。

## 7. 与 `notes/runtime-triage.md` 的分工

- `notes/runtime-triage.md`（本仓 `notes/`）：**宿主/传输/部署**层的低成本定位法与反模式。
- 本文：**浏览器客户端**层的取证法与判定矩阵。
- 两者共用同一条纪律：先锁文案/状态，再谈机制；把已证伪项写下来，下一轮不重查。
