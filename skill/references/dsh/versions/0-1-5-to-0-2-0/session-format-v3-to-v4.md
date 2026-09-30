# 会话格式 V3 → V4：迁移边、拒绝规则与适配动作

本文是 `references/dsh/versions/0-1-5-to-0-2-0/index.md` 的子页。**默认不读**：只有从 0.1.5 线升级、或要读
0.1.5 时代写下的会话日志时才进这里。

上游事实出处：`deepseek-harness@dsh-v0.2.0-rc.2`（对照 `dsh-v0.1.5-rc.3` 与 `dsh-v0.1.7-rc.2`）。

## 1. 改了什么

**版本号从 3 到 4。** `SESSION_FORMAT_VERSION` 在 `dsh-v0.1.5-rc.3` 是 3、在 `dsh-v0.1.7-rc.2` 是 4（常量在
`packages/core/session`）。同一窗口里，记录体系 `docs/persistence-changes` 从**不存在**（0 个文件）变成 161 个
文件 / 40 个中文页，其中 `docs/persistence-changes/historical-formats/README.zh.md` 是 V1–V4 的历史 schema 索引。

**多了一个迁移库。** `packages/session/session-format-v3-to-v4`（0.1.5 上不存在）负责「在不改写已存储代际的前提
下，把受支持的已发布 V3 恢复为 V4」；它同时提供相邻迁移、已发布的 V3 源 codec、V4 codec 与目标校验器。

**具体的表示变化**（迁移边只改这些，其余字段原样保留）：

| V3                                                                                                         | V4                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `tool/result` 的 `data.message.role: 'user'` + `tool-result` wrapper                                       | `role: 'tool'`；`content` / 可选 `isError` / `toolCallId` 直接落在消息上，wrapper 移除 |
| wrapper 上的其它字段                                                                                       | `plugin:result:<原字段名>`                                                             |
| 外层消息除 `id` / `role` / `source` / `content` 外的字段                                                   | `plugin:message:<原字段名>`                                                            |
| 未知内容标签 `<type>`                                                                                      | `plugin:<type>`（**已有前缀会再叠一层**）                                              |
| 插件消息来源 `{ plugin, kind }` 包装                                                                       | `kind` 被替换、`plugin` 属性移除                                                       |
| 具名第一方生产者（`goal`、`schedule`、`skill-invocation`、`user-approval`、`hooks-*`、`subagent-report`…） | 保留原名（表见上游 README）                                                            |
| 其它插件名 `acme`                                                                                          | `plugin:acme`                                                                          |
| `compact` / `tools-code-mode` / `tools-ptc`                                                                | `compact-checkpoint` / `ptc-mode` / `ptc-mode`                                         |
| `@deepseek-ai/dsh-system-prompt`（system 角色 / 其它角色）                                                 | `system-prompt` / `runtime-context`                                                    |

**会整份拒绝的输入**（不是降级，也不发布 successor）：工具定义带顶层 `deferLoading`（该字段只在 V4 定义，迁移边
不赋予历史含义）；嵌套工具结果；canonical wrapper 格式不合法；序号断裂、未结算工具、进行中的 compaction；
seeded 会话缺少 tagged 的继承截点 marker 或截点越界；V3 源 marker 声明 delivery generation 4（提升 header 不得
激活目标代际的 watermark）；缺少显式子级证据（`createStage()` 直接拒绝；空数组才是「没有子级」）。部分输出不
代表成功——后续行或 `finish()` 仍可拒绝整份产物。

**Header 与正文是两件事**：`sessionFormatV3ToV4.migrateHeader(header)` 只校验并推进元数据，不读正文、不收集子
Session；正文恢复必须显式提供子级证据（`createSessionFormatCatalogWithChildren(childFacts)` →
`createRestore(physicalHeader, { recovery: 'strict', validation: 'current' })` → `decodeRow` → `finish()`）。

## 2. 为什么坏

- **旧日志要过迁移边**：V4 构建读 V3 数据时，上面任何一条拒绝规则命中就整份不成立；「只有一半行解出来」不等于
  成功。恢复策略与错误处理归格式协议与 JSONL 持久化（见 `references/dsh/persistence-and-format.md`）。
- **反向也不成立**：0.1.5 时代的插件读 V4 日志时，工具结果已经是 `role: 'tool'` 的消息、来源已经改名或带
  `plugin:` 前缀、未知标签已经命名空间化——按旧假设分支会走错。
- **来源比对的假设失效**：把 `kind` 与插件名当同一个值（V4 起两者分离），或用旧名字符串（`compact`、
  `tools-ptc`）匹配来源。
- **`deferLoading`**：只在 V4 存在的字段，写在 V3 数据上会导致迁移边拒绝。
- 本仓笔记里「旧 completion API 废弃」这类说法在本页不作为事实引用——它无法在本地 tag 上复核。

## 3. 升级要动什么

1. **事件词汇与投影**：按上表处理来源、工具结果与内容标签；`deriveMessages()` 的 surface 规则见
   `references/dsh/session-log.md` §4–§6。
2. **恢复侧**：把「读旧日志」当一等路径——提供子级证据、选好 `recovery` / `validation`，并接受「部分输出不算
   成功」。
3. **权威**：兼容性看 `SESSION_FORMAT_VERSION` 与持久化变更记录，不看类型提示；相邻迁移与不可变代际见
   `references/dsh/persistence-and-format.md` §5–§7，新增格式版本的实操见
   `docs/cookbook/adding-a-session-format-version.zh.md`。
4. **验证**：除了新写路径，还要回放一份 0.1.5 时代的日志——只用新数据测试**测不到**这条边。

## 4. 静默失效

1. 用「事件类型 / 字段存不存在」判断兼容（改写是显式改名，存在性检查照样通过）。
2. 只测新写、不测旧读。
3. 假设 `plugin:` 前缀只出现一次——已经带前缀的旧名字会变成 `plugin:plugin:<原名>`；用 `startsWith('plugin:')`
   判断「这是我自己的标签」会误判。
4. 认为 `migrateHeader()` 通过就等于正文可恢复。
5. 给只在 V4 定义的字段（如 `deferLoading`）在 V3 数据上补历史语义。

## 5. 复核（只读）

```bash
git -C <checkout> show dsh-v0.1.5-rc.3:packages/core/session/src/types.ts | grep SESSION_FORMAT_VERSION
git -C <checkout> show dsh-v0.1.7-rc.2:packages/core/session/src/types.ts | grep SESSION_FORMAT_VERSION
git -C <checkout> ls-tree --name-only dsh-v0.1.7-rc.2 packages/session/ | grep format
git -C <checkout> ls-tree --name-only dsh-v0.1.5-rc.3 packages/session/ | grep format
```

前两行给出 3 → 4；后两行显示 `session-format-v3-to-v4` 是这一段新出现的（0.1.5 上没有它）。迁移规则的原文用
`git -C <checkout> show dsh-v0.2.0-rc.2:packages/session/session-format-v3-to-v4/README.zh.md` 看。
