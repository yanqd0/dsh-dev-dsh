# skill 型插件：随包分发知识

本文是 `references/develop/index.md` 的子页，回答「插件怎么把一份知识（skill）随包带出去、怎么装到用户机器上、模型怎么看到它」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`docs/subsystems/skills.zh.md`（注册表、roots / rank、frontmatter）、
`packages/skill/skill-filesystem/src/index.ts`（本地提供方）、`packages/skill/skill-badge/src/index.ts`（随包 provider 最小实现）。

本仓已验证的 content-sync / 双触发点工程模式在 `references/develop/build-and-pitfalls.md` §5，本页不重抄；
挂载与清单见 `references/develop/mounting-and-manifest.md`。

## 1. 判据

- 「skill 型」= 插件的主要交付物是**知识**：SKILL.md 及其 references，加一条把它装到位或注册进注册表的逻辑。
- 如果知识只是插件的附带文档，不是给 agent 看的 skill，那属于普通宿主插件（见 `references/develop/host-entry-and-di.md`）。
- 官方 Creator mode 已自带 creator skill（`packages/preset/agent-preset/skills`），本手册只补**仓外仓库怎么落自己的 skill**。

## 2. 目录与 frontmatter 契约

本地文件系统提供方接受两种形态（`docs/subsystems/skills.zh.md`）：

- 目录包：`<name>/SKILL.md`；
- 扁平文件：`<name>.md`。

不支持递归发现 `**/SKILL.md`（`packages/skill/skill-filesystem/src/index.ts`）。frontmatter 规则：

- 首行必须是 `---`，且有闭合 `---`，YAML 解析为对象；
- **`name` 与 `description` 必填**；`name` 必须 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）；
- 调用策略键用规范名 `disable-model-invocation` / `user-invocable`，省略默认 `true`；
- 模型会话目录只使用 `name` + `description`，不含正文、绝对路径与 source。

## 3. 两种分发形态

| 形态             | 落点                                     | rank | 特点                                                         |
| ---------------- | ---------------------------------------- | ---- | ------------------------------------------------------------ |
| 落盘同步（推荐） | `<dshHome>/skills/<skill-name>/`         | 400  | 不经任何宿主服务；写文件即完成，content-sync 与双触发点见 §5 |
| 随包 provider    | 插件进程内 `ctx.skills.registerProvider` | 600  | 不落盘、随包走；需要 `skill` 服务在组合里，且要有 consumer   |

本地发现优先级（`docs/subsystems/skills.zh.md`）：

| Rank | Source           | Root                                                    |
| ---- | ---------------- | ------------------------------------------------------- |
| 100  | `project-dsh`    | `<projectRoot>/.dsh/skills`                             |
| 200  | `project-agents` | `<projectRoot>/.agents/skills`                          |
| 300  | `custom`         | `Config.customSkillDirs`                                |
| 400  | `user-dsh`       | `<dshHome>/skills`（`$DSH_HOME` ?? `~/.dsh`）           |
| 500  | `user-agents`    | `<agentsHome>/skills`                                   |
| 600  | `bundled`        | `Config.bundledSkillDir`（或 `$DSH_BUNDLED_SKILL_DIR`） |

单层内重名按 rank 裁决；模型侧要看到 skill 还需要一个 consumer（`tool-skill`）在组合里跑，
官方 web-app 组合让 preset 拥有这两个行。

## 4. 最小示例

**形态一：落盘同步型**（本仓模式）

```
my-knowledge-plugin/
├── package.json          # files 含 dist 与 cordis.patch.yml；postinstall 走守卫脚本
├── cordis.patch.yml      # - insert: [{ id, name, config: {} }]
├── skill/<my-skill>/SKILL.md
└── src/{index,install-skill}.ts
```

```markdown
---
name: my-skill
description: 一句话路由描述（模型目录只读 name + description）
whenToUse: 可选补充路由提示
---

正文…
```

```ts
export const name = 'my-knowledge-plugin';
export const Config = z.object({ autoInstallSkill: z.boolean().default(true) });
export function apply(_ctx: unknown, config: Config): void {
  if (config.autoInstallSkill) installSkill();
}
```

`installSkill` 的目标是 `join(DSH_HOME ?? ~/.dsh, 'skills', '<my-skill>')`。

**形态二：随包 provider 型**（照 `packages/skill/skill-badge/src/index.ts` 收窄）

```ts
export const inject = ['skills'];
export function apply(ctx: Context) {
  ctx.skills.registerProvider(() => ({
    name: 'my-skills',
    list: () => Promise.resolve([candidate]),
    get: () => Promise.resolve({ name: 'my-skill', description: '…', content }),
  }));
}
```

candidate 用 `rank: 600`、`source: 'bundled'`、`resourceBase` 指向 `files` 里发布的资产目录；
资产文件本身**不需要 frontmatter**（元数据由代码给）。

## 5. 失败面

| 看到的串                                                                                                      | 成因                                         | 修法                         |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------- |
| `skill file <path> ignored: missing YAML frontmatter`                                                         | 首行不是 `---` / 没有闭合 `---` / 顶层非对象 | 修 frontmatter               |
| `skill file <path> ignored: frontmatter requires name and description`                                        | 缺 `name` 或 `description`                   | 补齐两者                     |
| `skill file <path> ignored: invalid skill name "<name>"`                                                      | 名字不是 kebab-case                          | 改名                         |
| `skill file <path> ignored: invalid YAML frontmatter: <err>`                                                  | YAML 解析失败                                | 修 YAML                      |
| `frontmatter field "<legacy>" is unsupported; use "<canonical>"`                                              | 用了旧调用策略键                             | 换成规范名                   |
| `skill provider "<p>" returned invalid skill name "…"` / `… without a description` / `… with an invalid rank` | provider 返回的 candidate 违规（快速失败）   | 修 `list()` 的返回值         |
| `skill "<name>" from <source> ignored because a higher-priority skill already exists`                         | 单层内 rank / 顺序仲裁落败                   | 提高 rank 或换个名字         |
| `[dsh-dev-dsh] skill source missing (<path>) — skipping skill install` / `skill install failed: <reason>`     | 落盘同步型的两条失败（只记日志、不抛）       | 检查 `dist/skill` 与 `files` |

**静默项**：frontmatter 非法的 skill 只 **warn + 跳过**，不报错、不阻止启动——「skill 不出现」先查这里。
来源：`packages/skill/skill-filesystem/src/index.ts`、`packages/skill/skill/src/index.ts`。

## 6. 验收

- 落盘同步型：`<dshHome>/skills/<skill-name>/SKILL.md` 存在且与源字节一致；整树一致时目录不动（无抖动）。
- 目录可见性：`ctx.skills.list({ cwd })` / `snapshot()` 里出现该 `name` + `description`，
  `source` 为 `user-dsh`（400）或 `bundled`（600）。
- 模型面：`dsh-tool-skill` 在会话首个完整视图注入 `name` + `description` 目录；正文只在真正调用时加载。
- 变更生效：watcher 发 `skills/change`（无 diff），消费方重新取快照。

## 7. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2:packages/skill/skill-filesystem/src/index.ts`（frontmatter 解析与 roots）、
`packages/skill/skill/src/index.ts`（仲裁与 provider 契约）。默认不读。
