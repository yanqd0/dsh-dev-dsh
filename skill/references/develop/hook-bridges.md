# hooks / 桥接：把别的 agent 的钩子事件转译进 dsh

本文是 `references/develop/index.md` 的子页，回答「已有一份 Claude Code / Codex 的 hooks 配置，怎么接进 dsh；想支持自己的协议又该写什么」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`packages/hooks/README.zh.md`、
`packages/hooks/hook-protocol/src/types.ts` 与 `codec.ts`、`.agents/notes/implemented/feature/2026-06-30-interception-extension-points.md`。

事件总表与 `next()` 语义见 `references/develop/host-entry-and-di.md` §5；事件域见 `references/dsh/extension-points.md`；
挂载见 `references/develop/mounting-and-manifest.md`。

## 1. 判据：先分清「谁是插件」

上游结论：**「native hook」不是包，就是订阅 canonical 生命周期事件的普通 Cordis 插件；CC / Codex bridge 只是把外部
shell hook 协议映射到同一套 API 的 translator**——bridge 能做的，裸插件都能直接做。

- **写 hook 脚本**：遵守上游协议的 shell 程序，经 `ctx.shell` 起子进程；脚本本身**不是 dsh 插件**。
- **写 bridge 插件**：把另一种 agent 的 hook 协议转译成 dsh 事件，复用 `@deepseek-ai/dsh-hook-protocol`——本类正题。
- **只加策略**：直接 `ctx.on('tools/pre-execute', …)`，见 `references/develop/peripheral-extensions.md`。

## 2. hook-protocol 契约

| 面       | 形态                                                                                                                                     | 权威路径                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 事件对   | durable、log-only：`hook/invoked{turn,point,dialect,matcher?,handlerId}` / `hook/result{…,decision,exitCode?,stderrSummary?,durationMs}` | `packages/hooks/hook-protocol/src/types.ts:19`   |
| dialect  | `type HookDialect = 'claude-code' \| 'codex'`——**闭集**，第三方不能新增值                                                                | `packages/hooks/hook-protocol/src/types.ts:48`   |
| 输出解码 | `parseHookOutput(exitCode, stdout, stderr, expectedEventName?)`；exit 2 = block，stderr 成 reason                                        | `packages/hooks/hook-protocol/src/codec.ts:59`   |
| matcher  | `matchesMatcher(matcher, query, mode)`；缺省 / `''` / `'*'` 为 match-all                                                                 | `packages/hooks/hook-protocol/src/matcher.ts:57` |
| 执行     | `runHook(bash, hook, options, now)` 走 `ctx.shell`；`DEFAULT_HOOK_TIMEOUT_MS = 600_000`                                                  | `packages/hooks/hook-protocol/src/runner.ts:67`  |
| 合并     | 多个 hook 的输出按最严格优先（`deny > ask > allow`）                                                                                     | `packages/hooks/hook-protocol/src/merge.ts`      |
| 事件写入 | `appendHookInvoked` / `appendHookResult`（同一 `handlerId` 成对）                                                                        | `packages/hooks/hook-protocol/src/events.ts:75`  |

bridge 的典型 `inject` 是 `['shell', 'sessionProjections']`；`configPath` 是**进程级**配置，加载时读一次，
相对路径按进程启动 cwd 解析。

## 3. 两家官方 bridge 的差异

|          | `hooks-claude-code`                                                                                                                                                     | `hooks-codex`                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 事件集   | 7 个（含 `SubagentStart` / `SubagentStop`）                                                                                                                             | 5 个（无 subagent）                                              |
| 点位映射 | `agent/created` → SessionStart；`agent/pre-step` → UserPromptSubmit；`tools/pre-execute` → PreToolUse；`tools/post-execute` → PostToolUse；`agent/turn-stopping` → Stop | 同左（无 subagent 两行）                                         |
| 子进程   | 注入 `CLAUDE_PROJECT_DIR`；`{CLAUDE_*}` 占位在解析期替换；stdin 带尾随换行                                                                                              | 无 hook env、无占位替换；payload 带 `model` 与 `permission_mode` |
| 只接受   | `type: 'command'`，其余进 skipped 并 warn                                                                                                                               | 仅同步 `command`；`async: true` 与非 command 都 skipped          |
| 配置来源 | `configPath: ./.claude/hooks.json`                                                                                                                                      | `configPath: ./.codex/hooks.json`                                |

两家 bridge 都**不在任何默认组合里**，要自己加 patch 行。

## 4. 最小示例

**启用官方 bridge**：

```yaml
- insert:
    - id: my-hooks
      name: '@deepseek-ai/dsh-hooks-claude-code'
      config: { configPath: ./.claude/hooks.json, projectDir: . }
```

**hook 脚本**（stdin 收 JSON；exit 2 + stderr = block，或 exit 0 + `hookSpecificOutput.permissionDecision`）：

```bash
#!/usr/bin/env bash
payload=$(cat)
echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"rm -rf blocked"}}'
exit 0
```

**bridge 插件骨架**（复用协议库；`dialect` 只能取闭集里的值）：

```ts
export const name = 'my-other-agent-hooks';
export const inject = ['shell', 'sessionProjections'];
export const Config = z.object({ configPath: z.string().required() });

export function apply(ctx: Context, config: { configPath: string }) {
  const groups = JSON.parse(readFileSync(config.configPath, 'utf8')).PreToolUse ?? [];
  ctx.on('tools/pre-execute', async (exec, next) => {
    const outputs = [];
    for (const group of groups) {
      if (!matchesMatcher(group.matcher, exec.name, 'codex')) continue;
      for (const hook of group.hooks) {
        appendHookInvoked(exec.agent.session, {
          turn,
          point: 'PreToolUse',
          dialect: 'codex',
          handlerId,
        });
        const { output, durationMs } = await runHook(
          ctx.shell,
          hook,
          { payload, expectedEventName: 'PreToolUse' },
          () => performance.now()
        );
        outputs.push(output);
        appendHookResult(exec.agent.session, {
          turn,
          point: 'PreToolUse',
          handlerId,
          output,
          durationMs,
        });
      }
    }
    return mergeHookOutputs(outputs).decision === 'deny'
      ? { kind: 'deny', reason: 'blocked by hook' }
      : next();
  });
}
```

## 5. 失败面

| 看到的串                                                                                    | 成因                                 | 修法                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| `hooks-claude-code: could not load hook config "<path>": <err> — no hooks registered`       | 配置读不到 / 解析失败 / 非法 matcher | 修 `configPath` 或 JSON（**warn + 不注册 listener**） |
| `hooks-codex: could not load hook config "<path>": <err> — no hooks registered`             | 同上                                 | 同上                                                  |
| `SyntaxError: invalid claude-code regex matcher "<p>" on event "<E>"`                       | matcher 不是合法正则                 | 修 matcher（会被外层吞成上面那条）                    |
| `hooks-claude-code: skipping unsupported "<type>" hook on <event> (only command hooks run)` | 用了非 command hook                  | 改成 `type: 'command'`                                |
| `hooks-codex: skipping <reason> on <event> (only sync command hooks run)`                   | 非 command 或 `async: true`          | 改成同步 command hook                                 |
| `<point> hook requested updatedInput, which is not yet honored (ignored)`                   | 该输出字段尚未支持                   | 别依赖 `updatedInput`                                 |
| `hooks-claude-code: SessionStart hook failed: <err>` / `SubagentStart hook failed: <err>`   | detached 点位执行失败                | 看脚本输出；**catch + warn，不破坏 boot**             |

**静默项**：`continue: false` 只记录、不中断 run；`Stop` 的点位无条件阻断会让会话每一步都强制续跑。

## 6. 验收

- 会话日志里 `hook/invoked` 与 `hook/result` 按 `handlerId` 成对出现（turn 内）。
- 行为证据：模型可见的阻断文本是固定 fallback（如 `blocked by PreToolUse hook`）；被阻断的 prompt 以 `blocked` turn 结束。
- `dsh --profile <p> --dump-config` 核对 bridge 条目与 `configPath`。

## 7. 相邻但不同的桥接面

- **外部事件 → 新 dsh 会话**走 webhook，不是 hooks：`packages/webhook/webhook/src/index.ts` 的
  `ctx.webhookRuntime.register(rule)`，其事件表可按提供方种类合并扩展，正是给树外适配器留的口子
  （见 `docs/subsystems/webhook.zh.md`）。
- **把 dsh agent 暴露给外部客户端**是反向桥：`packages/acp/acp`（其内部还带 MCP 挂载器，见
  `references/develop/mcp-integration.md`）。

## 8. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2:packages/hooks/hook-protocol/src/codec.ts`（输出字段全集）、
`packages/hooks/hooks-claude-code/src/index.ts`（点位映射的完整样式）。默认不读。
