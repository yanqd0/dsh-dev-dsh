# dsh 设计原理与不变式

> 本文是 `references/dsh/index.md` 的子页。
>
> **范围**：写插件时**不能违反**的运行时不变式与设计准则——它们解释「为什么代码要这么写」，也是评审判据。
> 可介入的扩展点见 `references/dsh/extension-points.md`，运行时机制见 `references/dsh/plugin-model.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。本页写准则与不变式，不写随版本改写的清单。
> 上游权威：上游仓库根 `AGENTS.md`（常驻规则）、`docs/defensive-patterns.zh.md`、
> `docs/session-format-status.zh.md`、`docs/development.zh.md`、`docs/testing.zh.md`。

## 1. 会话日志不变式

- **模型可见 ⟺ 已记录**：任何进入模型请求的东西都必须能从会话日志重建。要给模型新的可见输入，
  **必须新增会话事件**，不能只在内存里塞。
- **单一真源**：`deriveMessages()` 从日志投影模型历史；fork、恢复、transcript、遥测、持久化都从这些持久
  settlement 派生，实时 UI 增量另走进程本地事件。
- **投影必需**：`ctx.sessionProjections` 是 host 读取方的必需 seam——消费方要么在激活时要求它，
  要么在注册表或必需 key 缺席时明确失败；贡献方不得为缺失的 host 值静默提供默认值。
- **持久事件按读方校验**：`SessionEventMap` 成员默认 _required-on-read_——不认识该事件的构建会拒绝这份日志，
  除非事件在信封上标了 `ignorable: true`。`SESSION_FORMAT_VERSION` 只在**结构**发生变化时 bump。

## 2. 注册、所有权与回收

- **注册是可逆的副作用**：一切贡献经 `ctx.effect()` / `ctx.on()`，注册表 `register()` 返回 disposer；
  卸载后副作用必须消失。
- **无特权内核**：没有需要打补丁的核心。新行为挂在文档化的扩展点上，不靠 façade、包装或监听顺序去「强制」。
- **行为跟着所有者**：一段行为归拥有它的插件或服务；包装别人的服务来改行为，在 reload / 多插件并存时会失效。
- **包自己的不变量由包自己断言**：只有当独立观测能够分叉时才发布 `./invariant`；空的 installer、
  只检查服务存在 / 插件元数据 / effect 的断言都不算有效断言。

## 3. 失败与边界

- **配置错误大声失败**：自包含时在加载期报错，否则在最早可解析点报错；绝不静默跳过缺失的 referent。
- **显式 > 隐式**：默认值是拥有者实现里的显式 `resolve(request): Spec` 步骤，不是 `run()` 里隐藏的 `?? default`。
- **只在真边界校验**：parser / config、排队、模型与工具 JSON、durable / file、worker、process、wire。
  同一进程内的类型化边界信任 TypeScript——不要为静态接口已经保证的值加运行时验证。
- **跨边界的不透明 id 必须 brand**（`Branded<B>`），不用裸 `string`。
- **不写死可调项**：随部署变化的取值必须是经校验的 `Config` 字段，能从配置改；协议常量、外部规格与安全
  不变量保持固定。
- **空的 `catch` 要命名错误并说明原因**，且 `try` 只包一条语句。

## 4. 版本与兼容

- 公共 API 处于 **pre-stable**：破坏性变更时**同时更新每个消费方**；有外部可感知的破坏性变更就立即记录
  upgrade guide。
- 已提交的会话 generation **绝不重命名、覆盖或删除**：迁移以相邻的 `vN → vN+1` 步骤发布一份新的
  version-named 后继；前驱既不隐含回退，也不隐含降级支持。
- 会话格式的现状与支持窗口以 `docs/session-format-status.zh.md` 为权威；本手册的版本差分页讲**插件该改什么**
  （见 `references/dsh/versions/index.md`）。

## 5. 可验证性：两面、门禁与不变量

- **源码面 vs 产物面，不混用**：静态门禁与测试经 tsconfig `paths` 把 workspace import 解析到 `src`，
  要求干净树上通过；消费构建产物 `lib/` 的门禁必须显式声明这一依赖（`docs/development.zh.md`）。
- **compiler face 显式**：有 host / client 两半的包用 leaf 配置 + solution-only 根；不要用根 solution 当配置。
- **能机械校验的不变量都接上门禁**，并且每条验收路径要能拒绝一个非法样例（`docs/testing.zh.md`）。
- **测试描述行为**：行为变了就连同测试一起改，并在改动说明里讲清楚原因。

## 6. 对仓外插件的落点

本仓作为仓外插件，直接受这几条约束：

- 注册必须可回收（§2）——否则插件卸载或 reload 会留残留。
- 挂载声明必须显式、可校验（§3）——缺 `config` 即校验失败，所以永远显式写。
- 不承诺文档没写的扩展点（§2）——只用 `references/dsh/extension-points.md` 里列出的接缝。
- 事实随基准演进（§4）——手册每页声明 provenance，来源失效由 `src/facts.test.ts` 报出来。

## 7. 源码最后手段

准则的完整表述在上游仓库根 `AGENTS.md`；实现细节冲突时以源码为准：

- `git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目。
