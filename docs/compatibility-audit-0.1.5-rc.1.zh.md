# dsh 0.1.5-rc.1 兼容性与插件定位审计

审计日期：2026-09-10

审计对象：`dsh-deepseek-vision` 0.1.9，对照 DeepSeek Harness 从
`0.1.5-alpha.2` 到 `0.1.5-rc.1` 的插件兼容性 changelog，以及本机
`codex/msst-plugin` 工作树 `97970998e5`。后者在官方目标 `aa8262ec09`
之上只有本地 MSST 功能和兼容性文档改动，没有额外修改本插件使用的 LLM、
Client 或 Session 接口。

## 结论

- 运行时代码无需为此次升级做破坏性迁移，也没有理由立即重构。插件在
  `0.1.5-rc.1` 源码树上通过类型构建、121 项测试、Host/Web 启动、bundle
  挂载及安装/卸载往返测试。
- 官方 Client 打包预设与插件冻结副本完全一致；新增的
  `SidebarRightGuideEntry.description`、`CodeBlockProps.contentRef` 和文档预览
  `scrollportRef` 均不在插件使用面内。
- 插件没有精确锁定任何 `@deepseek-ai/*` 依赖，只有可选的 `*` peer，因此
  changelog 所说的“把精确版本统一升级到 rc.1”在本仓库没有可修改项。
- 官方新增的 `deepseek-flash`（DeepSeek-V41-Flash）声明支持文字和图片。
  插件继承官方模型目录，且 `native-first` 按目录能力分流，因此该模型会直接走
  官方原生图片路径，不调用 VL 描述端点。
- 旧的 `deepseek-v4-flash-vision-exp` 并未从 rc.1 源码目录删除；它与
  `deepseek-v4-flash`、`deepseek-v4-pro` 一起保留。变化是默认模型改成了
  `deepseek-flash`。

## 建议修改

这些不是当前运行所必需的热修复，但应在下一次插件发布前完成：

1. 将 `package.json` 的 `dshCompat.anchorVersion` 更新为 `0.1.5-rc.1`，重新构建，
   使其与 `lib/build-anchor.json` 同步；这是发布产物来源记录，不是安装门禁。
2. 给 `deepseek-flash` 增加明确的原生直通回归测试。当前实现是按
   `inputModalities` 通用分流，已有旧视觉模型的直通测试，但测试名和样例仍主要锁定
   `deepseek-v4-flash-vision-exp`。
3. 更新中英文 README：把官方默认原生视觉模型改为 `deepseek-flash`，说明旧体验版
   仍在目录但不再是默认，并把产品定位从“给 DeepSeek 增加图片能力”收窄为
   “给文本模型提供视觉回退和视觉策略控制”。
4. 更新兼容性/版本文档中的旧 anchor 和 rc.2 时代措辞。无需新增 attachment
   provider；`dsh-llm-deepseek` 已声明依赖 `dsh-attachment-local`。

## 不建议删除或重构的部分

- 不删除 `native-first`：它让新原生模型零额外 VL 调用，同时保留文本模型回退。
- 不删除 `always-describe`：它仍适用于统一 OCR、固定视觉模型、独立供应商或希望图片
  不进入 DeepSeek 原生端点的场景。
- 不删除描述缓存、尺寸限制和稳定错误语义：这些只在回退路径执行，仍有独立价值。
- 不把插件改成 agent 工具。当前 provider 路由之所以必要，是因为它需要在模型选择和
  prompt 准入阶段真实声明 image 能力；普通 stream 中间件无法替文本模型通过该门禁。
- 暂不重写 Host 或 Client 架构。此次升级没有接口压力能证明这种重写值得承担风险。

## 插件是否仍有存在意义

如果用户只使用 `deepseek-flash` 的原生图片能力，且不需要强制描述、独立 VL 供应商、
文本模型兼容或统一 OCR，那么插件对该用户没有必要，卸载能减少一个 provider、设置卡片
和维护面。

如果仍要给 `deepseek-v4-flash`、`deepseek-v4-pro` 或自定义文本部署处理图片，或者需要
`always-describe` 的策略控制，插件仍有明确价值。它不再是“DeepSeek 获得图片能力的
唯一入口”，而是“原生视觉优先、文本模型回退”的兼容层。

## 本机配置提示

本机 `C:\Users\Siegfly\.dsh-next\settings.yaml` 仍显式保存：

```yaml
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash
```

持久化用户设置会覆盖 rc.1 bundle 的新默认值，所以升级本身没有把现有默认会话切到
`deepseek-flash`。要实际使用 V41 Flash，需要在 Models 页面重新选择它，或显式更新该
设置。此审计没有替用户修改运行配置。

## 验证记录

- `node scripts/check-compat.mjs C:\Users\Siegfly\.dsh-next`：四个运行包均为
  `0.1.5-rc.1`；Client externals、三组 purity 规则及 bundle handoff 全部一致。
- `pnpm test`：12 个测试文件、121 项测试全部通过。
- `pnpm run build`：TypeScript 与 Client bundle 构建成功。
- Vitest 输出了当前工具链不识别 `es2024` target 的警告，但未造成编译或测试失败；
  这是测试工具链提示，不是本次 dsh API 兼容故障。
