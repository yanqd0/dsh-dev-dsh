---
name: dsh-dev-dsh
description: >-
  在独立仓库（非 deepseek-harness monorepo）里开发、构建与调试 DSH 宿主插件：
  包形态与挂载声明、cordis 插件契约、以及官方文档未覆盖的踩坑清单。
whenToUse: 需要仓外开发一个可发布的 DSH 插件，或排查其挂载 / 加载失败时。
---

# dsh-dev-dsh

面向**仓外**（out-of-tree）DSH 插件仓库的开发指引：插件有自己的仓库、自己的
工具链、发布到 npm，而不是放进 `deepseek-harness` monorepo。

> **0.1.0 边界**：本 skill 只覆盖**宿主面**插件。客户端 / UI 插件（`dsh.client`
> 声明与预构建 bundle）不在范围内，属于 0.2.0。

<!-- PLACEHOLDER: 正文与 references 分册由 plan #2（issue #3 / #10）补全。 -->

<!-- 上游事实的版本 pin 与来源记录在 `src/facts.test.ts` 的 fact 清单中：
     绑定 `deepseek-harness@dsh-v0.1.7-rc.2`。正文一旦引用上游路径，
     必须同步在该清单里加一条 fact。 -->
