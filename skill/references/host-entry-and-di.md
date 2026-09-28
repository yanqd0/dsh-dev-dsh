# 宿主入口与 DI：导出形态、Config 校验、工具注册、事件

本文是 `SKILL.md` 的分册，回答「仓外宿主插件怎么写入口、怎么声明依赖、注册什么会失败」。
出处均相对快照 `deepseek-harness@dsh-v0.1.7-rc.2`；行号会漂移，由 `src/facts.test.ts` 复核。

## 1. 两种导出形态，混用会静默丢字段

一个宿主 function plugin 只能二选一（`packages/AGENTS.md` 的 "Plugin exports"）：

- 具名导出 `name` / `inject` / `Config` / `apply`；
- 或**单个** default 对象/类。

Loader 通过 `unwrapExports` 取插件：优先 `exports.default ?? exports`
（`vendor/loader/src/index.ts:201`）。所以一旦同时写了 `export default` 与具名
`inject`/`Config`，default 会**整体取代命名空间**，`inject` 与 `Config` 被静默丢掉——
插件照常加载，但依赖不等、配置不校验。上游把它记为
`docs/postmortem/0001-acp-default-export-drops-inject.md` 的教训。

形态不合法时的报错来自 `ctx.plugin`：
`invalid plugin, expect function or object with an "apply" method, received <typeof>`
（`vendor/cordis/src/registry.ts:319`）。

## 2. `Config`：对象 schema 缺省为 `{}`

- 导出的 `Config` 走 Standard Schema 校验，**同步**执行，不支持异步校验
  （`vendor/cordis/src/fiber.ts:28`）。
- 校验失败抛 `ValidationError`（继承 `TypeError`），文本形态：

  ```
  invalid config:
    - <issue.message> (at <issue.path>)
  ```

  （`vendor/cordis/src/fiber.ts:28`）

- 关键陷阱：object 类 schema 的**默认值是 `{}`**。因此"清单里省略 `config`"与
  "写 `config: {}`"都会走校验，只要有**必填字段**就失败。仓外 patch 里必须显式写全必填项；
  这也是"显式 `config`"这条硬约束的真正理由。
- 默认值、必填、volatile 等写法见 `docs/user/develop/basic/config.zh.md`。

## 3. `inject` 与可选服务

- `inject` 可以是服务名字符串数组，也可以是 `{ [service]: interceptConfig | null }` 映射；
  Cordis 用它等到服务就绪再激活插件（`packages/AGENTS.md`）。
- 声明过的服务用 `ctx.<name>`；**可选**服务用 `ctx.get('<name>')`
  （`ctx.<name>` 的代理是拓扑敏感的，未声明就访问不可靠）。

## 4. 注册工具

标准写法（也见 `docs/user/develop/basic/tool.zh.md`）：

```ts
export const name = 'greet-tool';
export const inject = ['tools'];

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'greet',
      description: 'Greet someone by name.',
      parameters: { name: { type: 'string', required: true, description: 'The name to greet' } },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return `Hello, ${args.name}!`;
      },
    })
  );
}
```

签名与失败面：

- `ctx.tools.register(definition): () => void`，返回**精确的 disposer**
  （`packages/core/tools/src/index.ts:1063`）。
- `output` 必填 `{ schema, render, presentationMeta? }`，缺 `render` 抛
  `tool "<name>" must declare output { schema, render, presentationMeta? }`
  （`packages/core/tools/src/index.ts:1069`）。
- `run_code` 名字被保留：`tool name "run_code" is reserved for the PTC mode presentation
transport and cannot be registered or shadowed`（`packages/core/tools/src/index.ts:1081`）。
- `defineTool` 是类型化助手，从 `parameters` 推导/校验 `args`
  （`packages/core/tools/src/schema.ts:554`）。
- 注册本身即 effect：`apply` 里调用 `register` 就会在插件卸载时随 fiber 一起回收；
  其它需要显式清理的资源用 `ctx.effect` / `ctx.on` 并返回 disposer（`packages/AGENTS.md`）。

## 5. 事件：没有 `agent/session-start`

**本快照不存在 `agent/session-start` 事件**。会话开始以 `agent/created` 表达，载荷带 `source`：

- `type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'`
  （`packages/core/agent/src/runtime-types.ts:125`）；
- `'agent/created'(payload: { agent, source: SessionStartSource, signal?: AbortSignal })`，mode `serial`
  （`packages/core/agent/src/runtime-types.ts:261`）。

常用扩展点（都在 `packages/core/agent/src/runtime-types.ts`）：

| 事件                                      | 形态                                                                     | 用途              |
| ----------------------------------------- | ------------------------------------------------------------------------ | ----------------- |
| `agent/pre-step`                          | waterfall，`{ agent, messages, turn, step, signal }` → `PreStepDecision` | 改注入消息 / 短路 |
| `agent/request` / `agent/request-error`   | waterfall → `LlmCallConfig`                                              | 调整请求与重试    |
| `agent/assistant-stream` / `agent/status` | emit                                                                     | 观察流与状态      |
| `agent/turn-stopping`                     | serial                                                                   | 收尾              |
| `agent/disposed`                          | emit                                                                     | 清理              |

工具侧（`packages/core/tools/src/index.ts`）：

| 事件                                       | 形态                     |
| ------------------------------------------ | ------------------------ |
| `tools/pre-execute` / `tools/post-execute` | waterfall，可改判定/结果 |
| `tools/execute`                            | waterfall，包裹执行      |
| `tools/result` / `tools/change`            | emit                     |

规则：

- **waterfall 必须调用 `next()`**，否则短路整条链；各 mode 的语义见
  `docs/user/develop/framework/events.zh.md`。
- 事件监听器同样是 effect，随插件 dispose 一起移除。
