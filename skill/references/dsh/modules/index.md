# dsh 模块与子系统索引（占位）

> 占位｜归属：dsh 本体｜填充：plan #16
>
> 本文是 `references/dsh/index.md` 的子页。

**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`（本册逐页填充时按页重声明）。

本册回答：「这个模块 / 子系统是干什么的、对外暴露哪些 `ctx` 服务与事件、仓外插件什么时候会碰到它」。

## 契约

- 命名：`references/dsh/modules/<slug>.md`——一页一模块或一子系统，kebab-case，slug 用上游包名去掉组前缀。
- 每页只写**外部契约与接线**：`ctx` 键、服务方法、事件、关键数据结构；内部设计按需再下钻一级。
- 每页声明事实 pin；引用上游路径同步登记 `src/facts.test.ts`。
- 覆盖率：plan #16 按 `packages/*` 组分批推进，逐页标注完成度，不追求一次写满。

## 上游对照

- 子系统逐页参考：`docs/subsystems`
- 跨子系统行为（服务映射、轮次 / 步骤生命周期、事件分类）：`docs/architecture.zh.md`
