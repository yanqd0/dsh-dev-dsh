# dsh 本体：架构、模块与版本

> 本文是 `SKILL.md` 的入口页（L1）。

本类回答「dsh 内部怎么搭起来、每部分对外给什么、版本之间差在哪」——它存在的意义就是让开发与定位
不必先去读源码。

## 阅读顺序

1. `references/dsh/architecture.md`：架构主干（层、平面、依赖方向、主干流转）。先读这页。
2. `references/dsh/plugin-model.md`：运行时原理（服务、事件、可逆副作用、生命周期）。
3. `references/dsh/extension-points.md`：扩展点判据（事件域、capability seam、scope）。
4. `references/dsh/design-principles.md`：不变式与设计准则（写码时不能违反什么）。
5. `references/dsh/modules/index.md`：模块 / 子系统索引（外部功能与接口）。
6. `references/dsh/plugins/index.md`：内置 plugin 索引（哪些位置已经被占了）。
7. `references/dsh/versions/index.md`：版本窗口与反 CHANGELOG（历史插件为什么坏、升级要改什么）。

## 纪律

- 主干页跨版本稳定；版本细节只出现在版本页与受影响页的「版本差异」小节。
- 每页声明事实 pin；引用上游路径必须同步登记 `src/facts.test.ts` 的台账。
- 源码是最后手段：本类先给结论与指针，确认手册确实缺这一块再去读。
