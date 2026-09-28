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

<!-- PLACEHOLDER: 正文由 plan #2（issue #3）补全。 -->

## references

| 主题                                                 | 文件                                  |
| ---------------------------------------------------- | ------------------------------------- |
| 挂载与清单：patch 语义、层序、包清单字段             | `references/mounting-and-manifest.md` |
| 宿主入口与 DI：导出形态、Config 校验、工具注册、事件 | `references/host-entry-and-di.md`     |
| 构建、发布与踩坑：仓外仓库的工程面                   | `references/build-and-pitfalls.md`    |

<!-- 上游事实的版本 pin 与来源记录在 `src/facts.test.ts` 的 fact 清单中：
     绑定 `deepseek-harness@dsh-v0.1.7-rc.2`。正文一旦引用上游路径，
     必须同步在该清单里加一条 fact。 -->
