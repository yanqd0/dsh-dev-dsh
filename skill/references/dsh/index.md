# dsh 本体：架构、模块与版本

> 本文是 `SKILL.md` 的入口页（L1）。

本类回答「dsh 内部怎么搭起来、每部分对外给什么、版本之间差在哪」——它存在的意义就是让开发与定位
不必先去读源码。

**版本不同先读这里**：`references/dsh/versions/index.md` 顶部有「一行一条版本线」的极简 CHANGELOG；从 0.1.7 /
0.1.5 线升级或定位该线插件问题时，再进入对应差分页——差分内容默认不读。

## 阅读顺序

1. `references/dsh/architecture.md`：架构主干（层、平面、依赖方向、主干流转）。先读这页。
2. `references/dsh/plugin-model.md`：运行时原理（服务、事件、可逆副作用、生命周期）。
3. `references/dsh/extension-points.md`：扩展点判据（事件域、capability seam、scope）。
4. `references/dsh/design-principles.md`：不变式与设计准则（写码时不能违反什么）。
5. `references/dsh/composition-and-boot.md`：组装与启动链路（层序、loader 条目树、激活与失败判定）。
6. `references/dsh/plugin-management.md`：运行期插件管理（安装、启停、reconcile、豁免、重载）。
7. `references/dsh/client-loading.md`：客户端装载（声明、启动图、combo 路由、两阶段启动）。
8. `references/dsh/session-log.md`：会话日志与派生上下文（事件词汇、surface、`deriveMessages()`、插件扩展点）。
9. `references/dsh/persistence-and-format.md`：持久化、崩溃恢复与格式版本（seam / 句柄、flush 屏障、迁移链）。
10. `references/dsh/concept-model.md`：概念模型（DDD 映射 + 中英对照 + 关系图）。
11. `references/dsh/domain-vocabulary.md`：官方术语索引（权威在哪、按域分组、相互关系）。
12. `references/dsh/modules/index.md`：模块 / 子系统索引（逐组外部契约；A/B 批已就位，其余批次见覆盖表）。
13. `references/dsh/plugins/index.md`：内置 plugin 位置与冲突语义（哪些位置已经被占）。
14. `references/dsh/versions/index.md`：版本窗口与反 CHANGELOG（历史插件为什么坏、升级要改什么）。

## 纪律

- 主干页跨版本稳定；版本细节只出现在版本页与受影响页的「版本差异」小节。
- 每页声明事实 pin；引用上游路径必须同步登记 `src/facts.test.ts` 的台账。
- 源码是最后手段：本类先给结论与指针，确认手册确实缺这一块再去读。
