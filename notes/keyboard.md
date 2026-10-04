# keyboard 子模块：提示卡的 Enter / ↑↓ 补位

> 本页是 `src/keyboard/`（含浏览器半边 `dist/client.js`）的设计与取舍记录（试验性子模块 #2，plan #24）。
> 定位：本仓除「skill + 安装它的宿主插件」之外的**试验性小模块**；与 `src/uv/` 并列，稳定后再考虑剥离。
> 现象、源码位置与产物形状都来自本机实测，不写「预期如此」。

## 1. 问题：提示卡弹出后 Enter 什么也不做

dsh Web GUI 里，授权卡、方案复核卡、用户问题卡都会**接管 composer**（`ctx.slots.register({ name: 'conversation.composer', priority: 1, … })`），
渲染时原输入框被卸载，而**没有任何一方接管焦点**：`document.activeElement` 落回 `document.body`。
这三张卡的键盘处理却都要求「焦点已在卡内」，于是键盘在提示卡上基本失效：

| 卡       | DOM 锚点                                                     | 键盘现状                                                                                                                            |
| -------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 授权     | `[data-approval-key]`（内含 `[data-approval-scroll]`）       | `ApprovalPanel.tsx` 的 `onKeyDown` 第一道 gate 是 `event.currentTarget.contains(document.activeElement)`，焦点在 body 时直接 return |
| 方案复核 | `[data-plan-review-key]`                                     | `PlanReviewPanel.tsx` 全无键盘处理，「讨论 / Approve」两个按钮只在自身聚焦时响应 Enter                                              |
| 用户问题 | `[data-question-key]`（选项 `button[role=radio\|checkbox]`） | 选项按钮各有 `onKeyDown`，但只作用于自身；默认项由 `recommendedFirstOption` 预选，移焦入卡后 Enter 才会提交                         |

另外 `approval.allow` / `approval.reject` 两条 `registerFixed` 只是**展示用登记**，没有任何 handler 消费它们。

## 2. 方案选择

### 2.1 采纳：客户端半边 + `observeFixedInput` 补位

`ctx.shortcuts.observeFixedInput` 在**本地处理器之后**投递已仲裁的按键（`packages/client/shortcuts/src/client/dom.ts`），
所以插件只在这三种情况下介入：**存在提示卡、焦点不在卡内、无 modal、`region === 'page'`**。

- `Enter` → 点击卡内主操作（授权=允许一次／方案复核=Approve／问题=提交已选默认项）；
- `↑` / `↓` → 在卡内可选项之间移动焦点（跳过 disabled、首尾环绕）；
- 卡首次出现时把焦点移入卡内答案区（表格 `[data-*-scroll]`，没有则用主操作）。

**绝不 `consume()`**：它覆盖的正是「没有任何一方认领这个键」的场景，不参与仲裁才能让上游行为在原位继续生效。

### 2.2 否决：改上游组件 / patch 安装好的代码

`ApprovalPanel` 的 gate 少一个 `document.activeElement === document.body` 分支就修好了，
但那是 `@deepseek-ai/*` 已安装文件，patch 不在可接受范围内；重写替换组件是兜底方案，成本与跟版风险都远高于补位。

### 2.3 未被上游配置覆盖

`@deepseek-ai/dsh-user-questions` 的 `Config = z.object({})`，客户端键盘行为没有任何可配置面；这条不是「没找对开关」，是确实没有。

## 3. 挂载与开关

- 包 `package.json` 声明 `dsh.client: { platform: 'web' }` 与 `exports["./client"]`；
  客户端 roster 由宿主扫描 loader row 的包清单得到（`packages/client/modules/src/index.ts`），
  而本包的 `dsh-dev-dsh` row 本来就由 `cordis.patch.yml` 挂载，**所以不需要改 profile**。
- 浏览器产物是 `dist/client.js`：官方 `clientBundle` preset 未发布，故由 `scripts/build-client.mjs` 手写 wrapper
  （`window.__ModuleLoader__.load({ id, factory })` + 显式 `exports.apply` / `exports.inject`），
  形状对齐官方产物 `@deepseek-ai/dsh-client-ui-approval/lib/client.js`。构建脚本自检产物必须带注册调用、id、`factory:`、两个导出，
  且不是 ES module —— 不合格就非零退出。
- **开关怎么进浏览器**（踩过的坑）：客户端 entry **拿不到挂载行的 `config`**——
  实测 `apply(ctx, cfg)` 里的 `cfg` 不含 `keyboard`，于是半边一直读到 `enabled: false`、
  彻底静默。官方的做法是宿主半边订阅 `webserver/index-inject` 往页面注入一个 global
  （`@deepseek-ai/dsh-client-shortcuts` 注入 `__DSH_SHORTCUTS_CONFIG__`）；
  `src/keyboard/host.ts` 照此注入 `__DSH_DEV_DSH_KEYBOARD__`，
  `src/client-entry.ts` 的 `keyboardEnabled` 优先读它、其次才读 Loader 传的 `cfg`。
  订阅方式是**直接 `ctx.on('webserver/index-inject', …)`**——官方那个能正常注入的宿主半边
  （`dsh-client-ui-settings-models`）就是这么写的：cordis 的 `on` 不需要 inject，没有 web server 的组合
  只是永远不会收到 emit，插件照常加载。**不要**先 `ctx.get('webserver')` 再注册：那一步会静默失败，
  而失败若又落在「没有 logger 就不打日志」的兜底里，就变成**整条特性无声失效**（这次的真实教训）。
  开启方式：

  ```yaml
  # ~/.dsh/profiles/<profile>/cordis.patch.yml
  - id: dsh-dev-dsh
    config:
      keyboard:
        enabled: true
  ```

  改完必须**重启 harness 并刷新页面**：注入表与 client bundle 都由宿主进程启动时定型，
  浏览器要重新拉取。生效的机械判据：`curl` 带 token 取 `/` 时应能在 HTML 里搜到
  `__DSH_DEV_DSH_KEYBOARD__`（宿主已注入），且 `plugins/??@yanqd0/dsh-dev-dsh/client.js` 与 `dist/client.js` 同源。

## 4. 契约与上游耦合面

本子模块依赖四条上游事实（按 `deepseek-harness@dsh-v0.2.0-rc.2` 核实，升级 dsh 后需重核）：

| 事实                                      | 位置                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `dsh.client` 声明与 `exports["./client"]` | `packages/client/modules/src/index.ts`（`resolveMeta` / `clientExportOf`）     |
| bundle 注册契约                           | `packages/client/modules/src/client/manifest.ts`（`ClientBundleRegistration`） |
| `observeFixedInput` 的投递时机            | `packages/client/shortcuts/src/client/types.ts` / `src/client/dom.ts`          |
| 三个 `data-*` 卡锚点                      | `ui-approval` / `ui-user-questions` 的组件                                     |

失败是 fail-loud 的：bundle 不再注册会让启动页报 `… did not activate`，整页不启动，不会静默失效。

## 5. 已知限制

- **判定依赖 `data-*` 锚点与 CSS Modules 类名前缀**（首选 `button[class*="_primary_"]`，回退操作行内最后一个可用按钮）。
  上游改类名时回退路径仍可用；两者都失效时 Enter 不动、`↑↓` 仍可移焦，不会误点。
- **`keyboard.enabled` 只在浏览器侧生效**：宿主 `installKeyboard` 仅记录并用一行日志说明如何开启。
- **不覆盖 `Esc`**：授权卡的 Esc 由卡片自身处理；焦点在卡外时的 Esc 是否也应等同拒绝，留作后续评估。
- 焦点移入卡内后，授权倒计时走上游既有的 `pending.holdFocus()` 路径，行为与手动点进卡内一致。

## 6. 测试

- `src/keyboard/dom.test.ts`：卡识别、忙/只读/惰性卡片、默认动作三级候选、选项采集。
- `src/keyboard/client.test.ts`：Enter / ↑↓ 行为、守卫矩阵、移焦策略（`shouldFocusOnAppear`）、首次出现移焦一次、服务降级与重复注册不致命。
- `src/keyboard/host.test.ts`：注入行的形状、无 web server 的 compose、订阅失败不致命。
- `src/client-entry.test.ts`：开关解析（page global 优先、`cfg` 兜底、非显式 true 一律关闭）。
- `src/keyboard/client-bundle.test.ts`：把 `dist/client.js` 当经典脚本在本 realm 里执行（`window` 换成假 facade、`globalThis` 即页面全局），
  验证注册 id、`apply` / `inject` 导出，以及**从注入 global 打开**与关闭两条路径（`dist/` 不存在时自跳过）。
- 命令：`pnpm test && pnpm check-types && pnpm lint && pnpm build && pnpm pack:check`。

## 7. 剥离路径

浏览器半边只依赖 `ctx.shortcuts` 与 `document`，不 import 任何 `@deepseek-ai/*` 值；
`src/keyboard/` + `src/client-entry.ts` + `scripts/build-client.mjs` 可整体搬进独立插件包，
宿主半边只保留 `src/keyboard/host.ts` 的一行开关记录。
