# 客户端插件验证阶梯：agent 能自证到哪一层

本文是 `references/dogfood/index.md` 的子页，回答「一个带浏览器半边的插件，agent 自己一口气验到哪一层、
剩下哪部分必须交给人」。取证方法见 `references/dogfood/client-console-diagnosis.md`；声明与挂载见
`references/develop/web-ui-plugins.md`。

**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`（行号由 `src/facts.test.ts` 复核）。

## 1. 阶梯总览

从下往上，每层能证明的东西严格递增，成本也严格递增；**agent 停在第四层**，第五层交给人：

| 层  | 能证明什么                                      | 谁来跑                         |
| --- | ----------------------------------------------- | ------------------------------ |
| 1   | 单元 / 契约：注册调用参数正确、纯逻辑正确       | agent（vitest）                |
| 2   | 产物形态：构建产物能被 shell 物化并注册到模块表 | agent（伪 `__ModuleLoader__`） |
| 3   | 活 slot 注册：挂载后 seat 里确有我们的键        | agent（Client Inspect）        |
| 4   | 数据层：宿主路由的每个分支返回预期状态与数据    | agent（HTTP 直连）             |
| 5   | 视图层：DOM 真的画对、交互真的可用              | **人眼 / 浏览器控制**          |

"装上了" 和 "用户看得到" 之间隔着第 5 层。安装成功、slot 注册成功都**不**等于界面正确——报结论时必须写清
停在哪一层。

## 2. 第 1–3 层：能自证的形态检查

- **第 1 层**：用假 ctx（记录 `ctx.slots.register` / `ctx.sidebarRightTabs.register` 收到的参数）
  断言注册参数，不碰浏览器。产物形态测试见 `references/develop/web-ui-plugins.md` §5。
- **第 2 层**：把构建产物放进沙箱，注入伪 facade——
  `window.__ModuleLoader__ = { load: ({ id, factory }) => … }`，再物化 factory 并断言它向 `require`
  要的模块都在基线或启动图里。这一层能抓到"包装形态错、外部化多声明"这类只有浏览器才炸的问题。
- **第 3 层**：挂载后查询活 slot 树（`cordis_inspect_list` 认 provider，再对 `Slots.listSubTree` 传精确
  `root`），确认 `sidebar.right.pane.tab` 之类 seat 里有自己 `id` 的键。它证明注册发生了；
  **不证明**组件渲染正确。

## 3. 第 4 层：数据层 HTTP 直连（本轮实证最有价值的技巧）

宿主 `ctx.webServer` 注册的路由**默认不受浏览器 cookie 认证**——cookie 只罩走了 connection 信任栅栏的路由
（主要是 `/api`），而自己 `register` 的路由只受 Host / Origin 约束。因此 agent 可以绕过页面直接验数据层：

```bash
curl -sS -i http://127.0.0.1:<port>/<prefix>/<endpoint>
```

这样做：每条路由的每个分支都跑一遍（正常返回、会话失效、参数注入、非法 id、未知路由），把状态码与 body
当断言对象。**看不见界面也能把数据层拿到很高信心**（某次实现里 6 条路由 + 4 类拒绝分支全由此验通）。

边界：若路由自己走了 connection 的信任栅栏，就需要带 `/api?token=<…>`；`webServer` 在 headless 组合里
可能不存在（注册前判空）。

## 4. agent 不可见面清单

免得反复试探——以下东西 agent 靠自己拿不到：

- **`sidebarRight` / `sidebarRightTabs` 不在 `Service.listService` 的编译期目录里**（它们是运行时
  `ctx.reflect.provide` 的服务）。因此：枚举不了已注册的 tab 类型与 guide 条目、调不了
  `openTab` / `openResource`、读不到布局状态。
- **guide 条目只在注册自定义卡片时留痕**：标准卡片渲染不产生可 inspect 的痕迹。
- **DOM 不可见**：没有浏览器控制时看不到渲染结果；`Slots.listSubTree` 只告诉你注册树，不告诉你像素。
- **动态客户端半边的符号面**（`ctx` / `React` / `host.call` / `styles` / `console`）可以用
  `Builtin.listBuiltins` 读到，但那是**动态包**的面，不是静态插件可用的通道。

## 5. 交给人时给什么

交出去之前先把能自证的部分钉死，再要一件最小的、可复制的人眼证据：

1. 复现步骤（点到哪个 tab / 面板）；2. 期望看到什么；3. 已自证到第几层（附命令与输出）；
2. 请在浏览器 Console 里跑的那一小段只读探针（模板见 `references/dogfood/client-console-diagnosis.md` §4），
   把返回值贴回来即可判定。

## 6. 动态包这条路：能做什么、不能做什么

**动态 Cordis 包**（会话内 `cordis_define` / `cordis_run`）可以让 agent 即时注册客户端 UI 做原型，符号面见
`Builtin.listBuiltins`。限制要写清：需要当前会话装载 cordis 工具组；定义是**进程内、会话作用域**，宿主重启即失；
浏览器页重载后要再显式 run 一次才恢复客户端半边。

与静态插件的分工：**原型用动态包，交付用静态插件**。本页的第 1–4 层同样适用于动态包（产物形态层除外）。

与 plan #11（评估客户端 Console 只读探针定位法的自动化）的分工：本页写"agent 能自证到什么程度"的阶梯与交人；
探针本身的自动化属 #11。

## 7. 源码最后手段

只在阶梯给不出答案时才读上游：`packages/extensions/cordis-host-runner`（client 查询的等待与重试策略）、
`packages/extensions/cordis-client-runner`（客户端 provider 面）、
`packages/extensions/tool-cordis/src/providers.ts`（Host provider 集合）。默认不读。
