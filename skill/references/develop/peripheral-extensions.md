# 外围扩展：挂在既有服务或事件上

本文是 `references/develop/index.md` 的子页，回答「不改核心、只往既有能力周围加策略 / 适配器 / 后台任务时，怎么选面、怎么落地」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`docs/capability-seams.zh.md`（seam 全景）、
`docs/tool-execution-pipeline.zh.md`（工具流水线顺序）、`docs/user/develop/framework/events.zh.md`（事件 mode）。

事件域三分、capability seam 三角色与 scope 语义见 `references/dsh/extension-points.md`；事件总表见
`references/develop/host-entry-and-di.md` §5；`ctx.tools` / `ctx.llm` 的归属见 `references/dsh/modules/kernel.md`
与 `references/dsh/modules/model.md`。

## 1. 判据：先选面，再写代码

- **只是观察**：`ctx.on('…')` 的 `emit` 型事件（如 `tools/result`），同步、不改结果
  （`packages/core/tools/src/index.ts:198`）。
- **要改判定**：`tools/pre-execute`（`packages/core/tools/src/index.ts:153`）waterfall 返回
  `PreToolDecision`（`allow` / `deny` / `cancel` / `ask`）。**必须调用 `next()`**，否则整条链被短路。
- **不可重排的策略**：`ctx.tools.guard(guard)` 单调守卫（`packages/core/tools/src/index.ts:1136`），
  在 approval 之后运行，返回理由串即拒绝。
- **要包裹执行**：`tools/execute`（`packages/core/tools/src/index.ts:164`）环绕分发，只能替换 `exec.signal`；
  结果改写走 `tools/post-execute`（`:176`）。
- **加模型提供方**：`ctx.llm.registerAdapter(providers, adapter)`（`packages/llm/llm/src/index.ts:396`），
  不是替换 `ctx.llm`（替换见 `references/develop/harness-core-replacement.md`）。
- **起后台任务**：`ctx.jobs.start(spec): JobId`（`packages/jobs/jobs/src/index.ts:110`）。
- **只挂既有服务的事件、不注册任何服务**：`fs/*` 策略插件是范式——全文只有一个 `ctx.on`，
  决策型事件单槽位、故意**不调** `next()`（`packages/fs/fs-observation-policy/src/index.ts`）。

## 2. 接缝

| 面       | 形态                                                             | 权威路径                                       |
| -------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| 工具策略 | `tools/pre-execute` waterfall → `PreToolDecision`                | `packages/core/tools/src/index.ts:153`、`:607` |
| 单调守卫 | `ctx.tools.guard((exec) => string \| undefined)`                 | `packages/core/tools/src/index.ts:1136`        |
| 环绕分发 | `tools/execute` → 只可换 `exec.signal`                           | `packages/core/tools/src/index.ts:164`         |
| 结果改写 | `tools/post-execute` waterfall → `PostToolDecision`              | `packages/core/tools/src/index.ts:176`         |
| 适配器   | `LlmAdapter.stream()` + `registerAdapter(providers, adapter)`    | `packages/llm/llm/src/index.ts:396`            |
| 后台任务 | `ctx.jobs.start({ kind, label, owner, run })`                    | `packages/jobs/jobs/src/index.ts:110`          |
| 资源清理 | `ctx.effect(execute, label?)`，disposer 逆序执行；二次调用 no-op | `docs/cordis-api/fiber.zh.md`                  |

归属判据（「加文件系统策略 → `fs/*` 事件」「拦截请求 / 工具 / 轮次 → 对应 `agent/*`、`tools/*` 事件」）
在 `docs/architecture.zh.md`。

## 3. 最小示例

**策略门禁**（waterfall 返回类型化决策，来自 `docs/cookbook/extension-cookbook.zh.md`）：

```ts
export const name = 'permission-gate';
export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) return { kind: 'deny', reason: 'Denied by policy.' };
    return next();
  });
}
```

**模型适配器**（来自 `docs/user/develop/practice/llm-adapter.zh.md`）：
`class MyAdapter extends LlmAdapter { async *stream(options) { … } }` +
`export const inject = ['llm']` + `apply(ctx, config) { ctx.llm.registerAdapter(config.providers, new MyAdapter(config.apiKey)) }`。

**后台任务**（来自 `docs/cookbook/adding-a-tool.zh.md`）：

```ts
const id = ctx.jobs.start({
  kind: 'mycap',
  label: 'one-line model-facing label',
  owner: exec.agent,
  run: (job) => ({ cancel: () => {}, done: Promise.resolve({}) }),
});
```

任务发布后要用任务自己的取消信号（`job.cancel` / `JobHooks`），不要复用 `exec.signal`。

挂载方式与 tool 类相同：`- insert:` + 显式 `config`（见 `references/develop/mounting-and-manifest.md`）。

## 4. 失败面

| 看到的串                                                                                                                | 成因                                       | 修法                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------- |
| `background jobs unavailable: no job controller serves this agent (load @deepseek-ai/dsh-tool-jobs in its composition)` | 组合里没有 jobs 控制器                     | 引入 `dsh-tool-jobs` 或别用后台任务   |
| `invalid job kind: expected a non-empty string` / `invalid job label: …`                                                | `JobSpec` 必填字段为空                     | 补 `kind` / `label`                   |
| `background job limit reached for this owner (limit: <n>); use job_kill to stop an unneeded job, …`                     | 单 owner 任务数超限                        | 先结束无用任务                        |
| `an adapter for provider "<p>" is already registered`（`DUPLICATE_ADAPTER`）                                            | 同 provider 路由重复注册                   | 换 provider 名或先 dispose 旧注册     |
| `an adapter must register at least one provider`（`INVALID_ADAPTER`）                                                   | `providers` 为空                           | 至少给一个 provider 名                |
| `edit requires reading "<path>" first`（`FS_NOT_OBSERVED`）                                                             | 策略插件要求先观察再改，调用方没读过该文件 | 先读后改，或明确这是策略的预期行为    |
| `CordisError('INACTIVE_EFFECT')`                                                                                        | 对已 dispose 的 fiber 调 `ctx.effect`      | 检查生命周期，不要在卸载后挂新 effect |

来源：`packages/jobs/jobs-local/src/index.ts`、`packages/llm/llm/src/index.ts`、
`packages/fs/fs-observation-policy/src/index.ts`、`docs/cordis-api/fiber.zh.md`。

## 5. 验收

- 策略：被拒的调用在会话日志里落成带 `isError` 的 `tool/result`；`tools/result` 是同步、冻结、含失败的通知点。
- 适配器：路由成功后发布 `llm/adapters-updated`，可作观察点；`handle.replace()` 单次同步换路由。
- 后台任务：注册表事件流 `registered | progress | stopping | settled | output | removed`；
  模型侧由 `job_list` / `job_output` / `job_kill` 呈现。
- 事件策略：`fs/*` 门禁的可观察后果是 `FS_NOT_OBSERVED` 拒绝与随后写 / 改成功（不挂该插件则保留裸 provider 行为）。

## 6. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2:packages/jobs/jobs/src/types.ts`（`JobSpec` / `JobHandle` / `JobHooks` 逐字段）、
`packages/jobs/jobs-local/src/index.ts`（实现与 preflight 错误串）。默认不读。
