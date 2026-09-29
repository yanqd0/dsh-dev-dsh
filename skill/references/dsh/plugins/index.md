# dsh 内置 plugin 索引（占位）

> 占位｜归属：dsh 本体｜填充：plan #13
>
> 本文是 `references/dsh/index.md` 的子页。

**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.1`（本册逐页填充时按页重声明）。

本册回答：「dsh 已经内置了哪些插件、各自负责什么」——写新插件前先确认这块位置有没有被占，
既避免重复造轮子，也避免与内置行为打架。

## 契约

- 命名：`references/dsh/plugins/<slug>.md`——一页一内置 plugin（或一组强相关插件）。
- 每页写：职责、声明的服务与事件、在哪一层挂载（profile / bundle）、关闭或替换它的后果。
- 每页声明事实 pin；引用上游路径同步登记 `src/facts.test.ts`。
- 已占位置的门类先看 `references/dsh/modules/index.md` 与上游仓库根 `AGENTS.md` 的组清单。

## 与「新行为该放哪」的关系

放新行为前先在这里查两件事：能力是否已存在（该挂上去而不是重写）、以及谁拥有这个行为
（见 `references/dsh/architecture.md` §7）。
