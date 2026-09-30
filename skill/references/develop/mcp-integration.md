# MCP：把外部服务接进 dsh

本文是 `references/develop/index.md` 的子页，回答「接一个外部 MCP 服务，仓外到底要写什么、会在哪坏」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`docs/subsystems/mcp.zh.md`（职责与作用域）、
`packages/mcp/mcp-client/README.md`（配置字段表）、`docs/user/guide/mcp-memory.zh.md`（产品侧样例）。

`Config` 校验与导出形态见 `references/develop/host-entry-and-di.md`；patch / `insert:` / `files` 见
`references/develop/mounting-and-manifest.md`；「加面向模型的能力 → `ctx.tools`」的归属见 `references/dsh/extension-points.md`。

## 1. 判据：三条仓外路径，先选一条

MCP 在 dsh 侧的产品面是**配置**，不是「一个 server 一个插件包」。仓外有三种做法：

1. **只写 MCP server**：DSH 侧零代码，协议与 transport 由官方 SDK 拥有；能被 `tools/list` 发现即可。
2. **只写配置**：在你的组合包或 `--patch` 文件里加一条 `@deepseek-ai/dsh-mcp-client` 条目（一个条目连一台服务器）。
3. **写「桥接 MCP 的 dsh 插件」**：在插件里按 scope 挂客户端（上游先例 `packages/acp/acp/src/mcp.ts`），
   或只借工具适配器 `createMcpToolDefinition`（`packages/mcp/mcp-client/src/tools.ts`）把已有 schema 接进注册表。
   要暴露资源则注册 `ctx.mcpResources` 提供方。

选 3 的理由通常是「服务器的生命周期要跟着会话 / agent 走」，而不是「配置搞不定」。

## 2. 配置契约（一条目 = 一台 server）

| 字段         | 形态                                                                                                         | 说明                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `transport`  | `'stdio'` 或 `'streamable-http'`（常量）                                                                     | 必填                                      |
| `serverName` | `^[A-Za-z0-9_-]{1,32}$`                                                                                      | 必填；注册 scope 内唯一                   |
| stdio        | `command`（必填）/ `args` / `env` / `cwd`                                                                    | 由 MCP SDK spawn                          |
| http         | `url`（必填）/ `headers`                                                                                     | `streamable-http` 用                      |
| 共有         | `toolCallTimeoutMs`（默认 60000）/ `failOnStartupError`（默认 false）/ `maxInstructionBytes` / `reconnect.*` | 见 `packages/mcp/mcp-client/src/index.ts` |

客户端**不发布** `ctx.mcp`：它 `inject = ['tools']`，把发现的工具注册进工具注册表；资源面由共享服务
`ctx.mcpResources` 拥有，随附组合已挂载一次。

## 3. 最小示例

**只写配置**（放进你的组合包 patch 或 `--patch` 文件）：

```yaml
- insert:
    - id: my-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: my_server
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-github']
        env: { GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN }
```

**在插件里挂客户端**（照 `packages/acp/acp/src/mcp.ts`）：

```ts
export const name = 'my-mcp-mount';
export const inject = ['tools'];
export async function apply(ctx: Context, config: Config) {
  await ctx.plugin(McpClient, {
    transport: 'streamable-http',
    serverName: config.serverName,
    url: config.url,
    headers: {},
    toolCallTimeoutMs: 60_000,
    failOnStartupError: true,
  });
}
```

**只借适配器**：`const def = createMcpToolDefinition(ctx, { name, rawName, description, inputSchema, call })`
后自己做 `ctx.tools.register(def)`——注册、超时与 teardown 归调用方。

## 4. 命名与资源

- 模型侧工具名 = `mcp__<serverName>__<rawName>`；非法字符替换为 `_`，发生有损归一或超长时追加 12 位 hash 后缀。
  名字在重启 / HMR 后稳定；wire 名始终用 server 原始名。
- 资源三工具：`list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource`，都带 `server` 参数。
- `serverName` 在注册 scope 内唯一；不同 Agent scope 可复用同一名字。

## 5. 失败面

| 看到的串                                                                                                                                   | 成因                                                   | 修法                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------- |
| `mcp-client: serverName "<name>" is already in use by another mcp-client instance — pick a unique serverName in cordis.yml`                | 同 scope 内重名                                        | 换唯一 `serverName`             |
| `mcp-client(<server>): initial connection or tool synchronization failed`                                                                  | 启动连接 / 工具同步失败，且 `failOnStartupError: true` | 修服务器或关掉该开关            |
| `mcp-client(<server>): server listed tool "<name>" more than once — invalid tool list`                                                     | 服务器返回重复工具名                                   | 修服务器                        |
| `mcp-client(<server>): tool registration failed, no tools registered: <err>`                                                               | 注册冲突，整代回滚                                     | 看嵌套错误，先解决重名          |
| `connection failed and reconnect is disabled — no tools were registered` / `giving up after <N> consecutive failed reconnect attempts — …` | 连接失败且不再重试                                     | 查网络 / 命令，或开 `reconnect` |
| `mcp-client(<server>): server instructions exceed maxInstructionBytes (<n>)`                                                               | 服务器指令超限                                         | 调大上限或精简指令              |
| `MCP resource server "<name>" is unavailable in this agent's scope` / `… is already registered in this scope`                              | 资源提供方不在当前 scope / 重名                        | 检查作用域与注册时机            |

**静默项**：初始连接失败且 `failOnStartupError: false`（默认）时，harness 照常启动、**没有工具**、只留 error 日志。
排查「MCP 工具不出现」先看这里。

## 6. 验收

- `dsh --profile <p> --dump-config` / `--dump-config-schema`：确认条目与 `transport` / `serverName` 进了组合树。
- 工具列表里出现 `mcp__<serverName>__<rawName>`；资源工具名字与 `server` 参数正确。
- 连接级信号只有日志前缀 `mcp-client(<server>): …`——MCP **没有**专属 session event，不要拿 `hook/*` 验收。

## 7. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2:packages/mcp/mcp-client/src/index.ts`、`src/tools.ts`、
`packages/mcp/mcp-resources/src/index.ts`。默认不读。
