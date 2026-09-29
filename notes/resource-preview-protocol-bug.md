# 文件 / 计划预览「不可用」：客户端资源协议解析 bug

> 记录时点 2026-09-29。环境：dsh `0.2.0-rc.1`（本机 LAN 方案，浏览器经 HTTPS 反代访问）。
> 本文只记**现象 / 根因 / 解决方案**；定位方法本身另见
> [client-console-diagnosis.md](client-console-diagnosis.md)（并已进 skill 分册）。

## 1. 现象

| 观测                                                              | 结果                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| 侧边栏「文件」里打开任意文件（如 `AGENTS.md`、`.prettierignore`） | 正文区显示 **「文件资源服务不可用」**                        |
| 计划页签 / 计划卡片预览                                           | 显示 **「计划预览不可用」**                                  |
| 终端                                                              | 正常                                                         |
| 控制台                                                            | **无红色报错**                                               |
| 复现条件                                                          | 硬刷新后立刻坏；无痕窗口同样坏；换版本（0.1.7）/换机器同样坏 |

两条文案严格等价于同一个内部状态：

- `ui-sidebar-documentpreview` 的 `TextPreview`：`canRead = useResource(tab.contentId).status !== "none"`，
  `resourceUnavailable: "文件资源服务不可用"`。
- `ui-plan` 的 `PlanPreview`：`resource.status === "none" ? t("preview.unavailable")`。

## 2. 根因

**客户端资源注册表解析不出资源类型，导致它认为没有任何 provider。**

`@deepseek-ai/dsh-client-resources` 的 `protocolOf()`（源码
`packages/client/resources/src/client/resources.ts:67`）：

```js
if (parsed.protocol !== `dsh-resource:`) return void 0;
return parsed.hostname === '' ? void 0 : parsed.hostname.toLowerCase();
```

地址形态是 `dsh-resource://<type>/…`（`file` / `plan` / `plan-review` / `subagentchat` /
`changes-review`），由 `api-workspace-files`、`ui-plan`、`ui-reference`、`session-controller`
等共同产出。**但在 Chromium 里，`//` 后第一段恰好是特殊 scheme 名 `file` 时，
整个地址被解析成 opaque 地址**：

```
new URL("dsh-resource://file/session/s1/AGENTS.md")
  浏览器 → protocol "dsh-resource:"   hostname ""        pathname "//file/session/s1/AGENTS.md"
  Node   → protocol "dsh-resource:"   hostname "file"    pathname "/session/s1/AGENTS.md"
```

于是 `hostname === ""` ⟹ `protocolOf()` 返回 `undefined` ⟹

- `ResourceRegistry.create()` 写 `idle("none")`，此后 `providerOf(undefined)` 永远找不到
  已注册的 `file` / `plan` provider；
- 预览组件读到 `status: "none"`，显示「不可用」。

**这与"provider 丢失/服务回滚"无关**：实测注册表里 `providers` 有 `file`、`plan`，
但 `records` 里每条记录的 `protocol` 都是 `undefined`，`recordsOf("file")` 为 0。
把某条记录的 `protocol` 手工改成 `file` 再 `attach()`，同一秒就读到了文件内容——
根因当场闭合。

补充两点：

- 同一写法还在 `packages/client/ui-subagent` 的 `parseSubagentChatAddress()`
  （`url.hostname.toLowerCase() !== "subagentchat"`），同样会在浏览器里失效。
- Node 侧（单测、构建期）的 `URL` 给出 `hostname: "file"`，所以**这个 bug 在 Node 里永远测不出来**。

## 3. 解决方案

### 3.1 立即可用：客户端稳健解析（本机已采用）

不依赖 `hostname`，改为从 `//` 后第一段取 type（正则最稳；`URL` 只用来校验 scheme）：

```js
function protocolOf(address) {
  let parsed;
  try {
    parsed = new URL(address);
  } catch {
    return;
  }
  if (parsed.protocol !== `dsh-resource:`) return void 0;
  const matched = /^dsh-resource:\/\/([^/?#]+)/.exec(address);
  return matched === null ? void 0 : matched[1].toLowerCase();
}
```

- 验证矩阵：`file` / `plan` / `plan-review` / `subagentchat` / `changes-review` 全部正确；
  `sidebar://files`、`not-a-resource-url` 仍返回 `undefined`。
- 注意用 `pathname.split('/')[0]` 是**错的**：浏览器把 authority 丢进 pathname，
  `dsh-resource://plan/s1/call-1` 会得到 `s1` 而不是 `plan`。
- 本机落地：`~/scripts/dsh/patch-client-resources.sh`（幂等、带 `--revert`；
  `run.sh` 每次启动重打）。**已实测有效**（2026-09-29，用户确认文件与计划预览均恢复）。

### 3.1.1 写这个补丁时踩的坑（务必照做）

第一版补丁把说明注释放在 `return` 与表达式之间：

```js
return; /* 注释 */
const matched = /^dsh-resource:\/\/([^/?#]+)/.exec(address); // ASI 在 return 处结束语句
return matched === null ? void 0 : matched[1].toLowerCase(); // 永远执行不到
```

`return` 后换行会被 ASI 截断 ⟹ 函数恒返回 `undefined`；而**语法完全合法**，
`node --check` 查不出来，表现为「补丁标记在、记录 `protocol` 仍是 `undefined`、预览照样不可用」。

因此补丁必须满足：

1. **整行/整语句替换**（`NEEDLE` 含行首 `return`），注释放在语句之后；
2. **语义自检**：把改过的函数从文件里括号配平截出，`new Function(src + '; return fn')()`
   求值，断言上表样例；不过就回滚；
3. **幂等分支也复验语义**：只看标记会把历史坏补丁当成已完成，永远不修。

### 3.2 根治建议（上游）

- **A**（同 3.1）：解析不看 hostname；或
- **B**（更彻底）：改地址形态，把类型放在 path 而非 authority，
  如 `dsh-resource:/file/session/…`（单斜杠），读 `pathname` 第一段——从此不吃 scheme 名歧义。
  这需要同时改所有产出方与消费方。
- 另建议：`protocolOf` 这类"仅浏览器行为不同"的解析，加一条**浏览器侧**（或 jsdom +
  真实 Chromium 语义）的回归测试；仅靠 Node 单测覆盖不到。

## 4. 影响面与自检

- 影响：所有走 `useResource` 的预览（文件、计划、计划评审、子代理会话等）。
  终端不读 resource，所以正常。
- 自检（浏览器 Console，只读；页面上**没有**全局 `ctx`，要走 React fiber 取证，
  完整探针见 [client-console-diagnosis.md](client-console-diagnosis.md)）：把 fiber props 里
  的 `useResource`、或从 fiber 树上找 cordis ctx 后 `ctx.get('resources')` 取到注册表，看

  - `providers` 是否含 `file`/`plan`（补丁前也有，**不是**判据）；
  - 每条 record 的 `protocol` 是否已解析成 `file`/`plan`（**这才是判据**）；
  - 预览组件那一个 hook 的 `status` 是否不再是 `none`。

- 静态自检（不依赖浏览器，最便宜）：把下发的 `client.js` 与磁盘 diff，并按括号配平截出
  `protocolOf` 在 Node 里跑样例地址——**只看标记或只跑 `node --check` 会漏掉 ASI 那类坏法**。
