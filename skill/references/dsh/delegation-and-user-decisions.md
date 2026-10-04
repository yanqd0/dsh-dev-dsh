# 子级与用户决策：plan mode 边界与咨询循环

> 本文是 `references/dsh/index.md` 的子页。
>
> **范围**：子级 agent 碰上「必须由用户拍板」的事时会发生什么、宿主留了哪条路、以及这条路对并行与 token 的影响。
> 委派通道与并行机制见 `references/dsh/delegation-and-parallelism.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。本页给判据与手法，不抄签名。
> 上游权威：`packages/interaction/user-questions/README.zh.md`（人机交互 seam）、
> `packages/plan/plan-mode/README.zh.md` 与 `docs/subsystems/plan.zh.md`（plan mode）、
> `docs/subsystems/subagent.zh.md`（结算通知与 `sendMessage` 路由）、
> `packages/subagent/tool-subagent-control/README.zh.md`（`send_message` 的准入与失败面）。

## 1. 一句话结论

**子级不能发起人机交互，也不能替你呈交计划；但「子级提问 → 父级问用户 → 父级回投答案」是宿主设计内的用法，
而且第一与第三步可以是同一个子级。**

## 2. 子级不能发起人机交互

`dsh-tool-ask-user` 最终落到 `ctx.userQuestions.ask() / askTimed()`，两者都先过 `assertLiveRoot(agent)`：
调用者必须是 registry 里**确切的存活实例**，并且**是运行时根**（`AgentRegistry.roots()` = 没有 owner 的 agent）。
子级由父级创建并持有（`CreateAgentOptions.owner`），因此被拒：

```
Error: human interaction is unavailable while the calling agent is owned by another live agent;
include the unresolved question or decision in the child agent's final result
```

错误码是 `DELEGATED_CALLER`；文案本身就是宿主给的做法指引——**把未决问题写进子级的最终结果**。
子级调用 `ask_user_question` 在它的工具表里看得见（preset 给每个 agent 装同一套工具），但一定失败。

**plan mode 下再加一道门槛**（plan mode 本身是提示词层软约束：每个工具仍然可用，真正的强制在沙箱与审批）：

| 想做的事                                        | 子级能不能                     | 为什么                                                                                                                       |
| ----------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 只读调研、代码考古、方案评估、起草计划 markdown | **能**，把结论作为最终文本返回 | 子级在自己的 session 里挂 preset 的同一套工具                                                                                |
| 把「需要用户拍板的问题」直接弹给用户            | **不能**                       | 人机交互只接受运行时根 agent                                                                                                 |
| 呈交计划让用户批准（`exit_plan_mode`）          | **不能**                       | 先要求调用者自己的 session 处于 plan mode，再走一次人机交互评审（`intent: 'plan-review'`，选项 `Approve` / `Keep planning`） |

- **plan mode 状态随 fork 继承，不随 spawn 继承**：`plan/mode` 是仅记日志、整值替换的会话事件，
  恢复 / fork / compaction 都从日志折叠；`fork` 子级拿到父级已完成轮次前缀，因此自己也处于 plan mode；
  `spawn` 子级是空会话，默认**不在** plan mode。
- 由此有个易踩的坑：**父级在 plan mode ≠ 子级受约束**。派 `spawn` 子级去「评估」时，它的提示词里没有
  plan-mode 的「不要改文件」，它**可以**写文件（只受沙箱与审批约束）。派活要显式写只读要求，必要时用
  `toolFilter` 把写工具从子级作用域摘掉（要求 provider 支持 `toolFilter`）。
- 别把「用户口头同意」当批准：plan-mode 提示词写明对话里的同意不结束 plan mode，只有 `exit_plan_mode`
  评审通过才算；子级带回的用户答复同样要折进计划再呈交。

## 3. 咨询循环：子级提问 → 父级问用户 → 父级回投

**同一子级的闭环（首选）**：

1. 子级把问题写成**最终回复**（不调用 `ask_user_question`），结束本轮。它的 Activation 结算时，运行时向父级
   投一条 `subagent-settled` 通知：一句 `summary` + `Its closing message:` + 子级最终的非空文本块
   （没有非空文本时是 `It left no closing message.`）。问题因此落进父级 context——所以要求子级
   **只回「问题 + 选项 + 建议 + 影响」**，不要把研究过程搬进父级。
2. 父级（根 agent）用 `ask_user_question` 问用户；`questions` 是数组，**把多个子级的问题合并成一次调用**，
   一轮问完所有待决策项。
3. 父级按 childId 用 `send_message` 回投答案。投递按目标 Activation 状态路由：`running` 在最近 step 边界
   steer；`waiting` 唤醒并 steer；**已结算（无 Activation）则冷恢复同一个 child session 再投**。
   所以「同一个 subagent，只是停下来等了一下」成立——**身份与全部历史都在子级自己的 session 里**，
   进程侧可能重新物化一次 Activation。准入只允许直接 parent ↔ 直接可继续 child，
   **`one-shot` 子级（前台等待后即 dispose）被拒绝**：要闭环就得用 `continuable`（随产品 preset 已是默认）。

**变体 B（新子级 + 浓缩上下文）**：把「浓缩结论 + 用户答案」写进新 prompt 再起一个子级。代价是
**浓缩结论必须先进入父级 context**（否则新子级拿不到前一个子级的内部工作），与「省父级 context」直接冲突；
只有原子级已消失（one-shot）或不想留驻留子级时才划算。

## 4. 并行与 token：三个目标分别能不能达成

| 目标              | 结论                         | 依据                                                                                                                                                                                                                                                           |
| ----------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 并行跑调研 / 评估 | **能**                       | 兄弟委派并发安全、进 loop 滚动池；在线 continuable 子级上限 `maxActiveSubagents`（默认 8）                                                                                                                                                                     |
| 省父级 context    | **能，但取决于子级收尾文本** | 研究过程留在子级日志；父级只承担委派调用 + 子级收尾文本 + 用户答案 + `send_message` 调用                                                                                                                                                                       |
| 省总 token        | **取决于形状，不是自动的**   | 父级 context 会被它之后**每一次**请求重发，避免父级膨胀通常主导；但每次委派有固定开销（子级 system prompt + 工具 schema + 往返），且 **fork 子级把父级已完成轮次前缀带进自己的每次请求**——省了父级 context，总 token 反而更高。总量最小：`spawn` + 自足 prompt |

- 答案会在父级 context 里出现两次（用户消息一次、`send_message` 参数一次）——这是「子级不能直接问」的代价。
- 更省的一条路：**人在 GUI 里直接打开子会话回复**。浏览器 prompt Remote 能经在线直接父级投给可继续子级
  （容量允许时也能冷恢复），问题与答案都不进父级 context；代价是没有任何东西把子级的问题推给用户
  （子级发不出问题卡），得靠人去看子级 transcript。
- 想全自动：仓外插件可以监听父级 session 里的 `user/message`（`source.kind === 'subagent-settled'`）取出问题，
  以根 agent 身份调 `ctx.userQuestions.ask`，再用 `ctx.subagents.sendMessage(parent, childId, …)` 回投，
  把这个循环变成自动中继。
- 故障面：在线子级满时冷恢复以 `subagent/delivery-unavailable` 拒绝；一次性 / 未知目标在浏览器通道上报
  `subagent/not-resumable`；`maxDepth` 默认 1，子级不能再往下派。

## 5. 源码最后手段（默认不读）

- `packages/interaction/user-questions/src/index.ts`：`assertLiveRoot` 与 `ask` / `askTimed` 的准入。
- `packages/plan/plan-mode/src/index.ts`：`exit_plan_mode` 的门槛与 plan-review 提问。
- `packages/subagent/subagent/src/continuation-messages.ts`：结算通知的构造（读什么算「子级的收尾文本」）。
- `packages/subagent/subagent/src/control.ts`：浏览器 prompt 通道的 `subagent/not-resumable` 判定。
