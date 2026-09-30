# 新增工具（tool）：向模型暴露一个能力

本文是 `references/develop/index.md` 的子页，回答「写一个 tool 插件，从注册到模型真的能用，要走哪几步、会在哪坏」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`docs/user/develop/basic/tool.zh.md`（最小写法）、
`docs/cookbook/adding-a-tool.zh.md`（工具全生命周期）、`docs/subsystems/tools.zh.md`（注册表 API 块）。

入口形态与 `Config` 校验见 `references/develop/host-entry-and-di.md`；挂载与清单字段见
`references/develop/mounting-and-manifest.md`；`ctx.tools` 的归属、scope 与替换面见 `references/dsh/modules/kernel.md`。

## 1. 判据：什么时候是这一类

- 插件要做的事是**让模型多会一件事**（查询、计算、调用外部系统）——即贡献一条模型可见能力。
- 只需要**观察或改写既有工具调用**而不是新增工具名（拦截、审批、结果改写）——那是外围扩展，
  见 `references/develop/peripheral-extensions.md`。
- 名字以 `mcp__` 开头的工具不是你注册的，来自 MCP 连接（MCP 分类页会写清接入路径）。

## 2. 接缝

| 面         | 形态                                                                            | 权威路径                                |
| ---------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| 注册       | `ctx.tools.register(definition: ToolDefinition): () => void`，返回精确 disposer | `packages/core/tools/src/index.ts:1063` |
| 类型化助手 | `defineTool({ name, description, parameters, output, execute, … })`             | `packages/core/tools/src/schema.ts:554` |
| 模型可见面 | `ctx.tools.schemas(scope?)`，只白名单 `name` / `description` / `parameters`     | `packages/core/tools/src/index.ts:1260` |
| 服务依赖   | `export const inject = ['tools']`，注册表就绪后才激活                           | `packages/core/tools/src/index.ts:135`  |
| 注册表 API | `register` / `guard` / `restrict` 的完整签名与 scope 语义                       | `docs/subsystems/tools.zh.md:506`       |

注册是 **effect**：在 `apply` 里 `register` 就会随插件 fiber 一起回收；HMR 下换工具要 dispose 再注册，
不要就地改已注册的 schema 或回调。

## 3. 最小示例（仓外仓库可直接照抄）

```ts
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

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

挂载照常走 `cordis.patch.yml` 的 `- insert:` 加显式 `config`；语义与三条契约在
`references/develop/mounting-and-manifest.md`，本页不复述。

## 4. 参数与输出 DSL 的约束

- **参数根是隐式开放对象**：顶层 `parameters` 直接给属性表，必填靠逐属性 `required: true`
  （`docs/subsystems/tools.zh.md:151`）。
- **显式对象节点必须表态**：schema 里写 `type: 'object'` 的节点必须显式带
  `additionalProperties: true` 或 `false`，缺了直接报
  `<path>.additionalProperties must be explicitly true or false`
  （`packages/core/tools/src/schema.ts:368`）。
- **`output` 是注册前置**：`{ schema, render }` 缺一不可；`execute` 必须返回 `output.schema` 的规范 JSON 值，
  不是 content block；异常与非法值都收敛成 `isError` 结果（`docs/cookbook/adding-a-tool.zh.md`）。
- **名字是 scope 内唯一**，且 `run_code` 被 PTC 呈现通道保留。
- **遵守 `exec.signal`**；`exec.agent` 可用于向所属 agent 注入异步通知。

## 5. 失败面

| 看到的串                                                                                                             | 成因                                          | 修法                                 |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| `tool "<name>" must declare output { schema, render, presentationMeta? }`                                            | 缺 `output` 或 `render` 不是函数              | 补 `output { schema, render }`       |
| `tool name "run_code" is reserved for the PTC mode presentation transport and cannot be registered or shadowed`      | 用了保留名                                    | 换名字                               |
| `tool "<name>" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)` | 全局层重名                                    | 改唯一名，或按提示注册到 agent scope |
| `tool "<name>" is already registered in this scope`                                                                  | 同 scope 重名                                 | 同上                                 |
| `<path>.additionalProperties must be explicitly true or false`                                                       | 显式对象节点没表态                            | 补 `additionalProperties`            |
| `unsupported JSON schema: <violations>`                                                                              | `output.schema` 用了不支持的 JSON Schema 构造 | 收窄到受支持的子集                   |
| `invalid arguments: <violations>`（`INVALID_ARGS`）                                                                  | 模型给的参数过不了校验                        | 改 `parameters` 或 `execute` 的容错  |

都来自 `packages/core/tools/src/index.ts:1069`、`:1081`、`:747`、`packages/core/tools/src/schema.ts`。

## 6. 验收

- `ctx.tools.schemas()` 里出现你的工具名与参数 schema——这是模型可见投影的直接断言
  （`packages/core/tools/src/index.ts:1260`）。
- 真跑一轮：会话日志里的 `tool/call` / `tool/result` 是持久证据；`tools/change` 是注册 / 注销通知。
- 挂载层是否生效用 `dsh --profile <p> --dump-config` 核对（见 `references/develop/mounting-and-manifest.md`）。
- 上游要求 product-visible 插件有非单测的真实组合测试（经 Loader 与进程 boot 一个 test-only 组合），
  单测覆盖注册不等于验收（`packages/AGENTS.md`）。

## 7. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2:packages/core/tools/src/index.ts`、`src/schema.ts`、`src/json-schema.ts`
——查未在文档化的注册约束时用，默认不读（本页结论均可在上面的权威页与本页失败面里对齐）。
