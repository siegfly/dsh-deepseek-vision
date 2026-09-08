# DSH Next 接手说明：DeepSeek Vision Gateway

## 接手目标

当前分支已完成 API 兼容移植、产品定位审计和核心实现收敛。插件定位为新版 DSH 上的可选“文本模型视觉回退层”，不是原生视觉的替代品：

`旧版行为 → Next 架构/API → 差异 → 保留/删改/新增 → 验证用例`

审计范围包括 LLM gateway、图片预处理、prepared call、设置与凭据、Client 设置卡、构建 preset、匿名身份、请求记录、错误和安装。

## 目录与隔离

- 当前插件：`D:\Software\GIT-next\dsh-vl-gateway`
- 分支：`adapt/dsh-0.1.3-alpha.2`
- 旧插件：`D:\Software\GIT\dsh-vl-gateway`，只读
- 旧 DSH：`D:\Software\GIT\deepseek-harness-rc2`，只读
- Next DSH：`D:\Software\GIT-next\deepseek-harness`
- Next home/profile：`C:\Users\Siegfly\.dsh-next\profiles\web`
- Next Web：3081；启动脚本 `D:\Software\GIT-next\start-dsh-next.ps1`

不得修改旧目录、旧 home/profile 或停止 3080/10087 旧服务。

## 当前状态

插件包名为 `dsh-deepseek-vision`，工作区目录仍叫 `dsh-vl-gateway`。适配提交：

- `7a449fa fix: adapt vision gateway to dsh 0.1.3-alpha.2`

它通过 `link:D:\Software\GIT-next\dsh-vl-gateway` 安装到 Next profile。构建 anchor 指向 DSH `0.1.3-alpha.2`；client-runtime 已替换为 Next Client store/settings/renderer API；Host settings 使用 Next registration。

本轮实现结论：

- 新增 `native-first`（默认）、`always-describe`、`disabled` 三种模式；只用原生视觉时插件可关闭或卸载。
- prepared call 同时捕获 DeepSeek 与完整 VL generation，设置变化只影响下一次 prepared call。
- 缓存键升级为“完整 VL 投影 identity + attachmentId”；共享中的调用者可独立取消。
- 使用公开 `readImageRequest` seam 做确定性缩放/编码，并新增 `maxPixels`、`maxBytes`、`maxTokens`。
- Host settings mutation 的 `ok` 才代表保存成功；恢复原生 passthrough 的 image access；占位错误不再泄露第三方原文。

仍需明确保留的风险：描述缓存是进程内缓存，不跨重启持久化；DSH 当前没有让插件把“图片→描述”投影作为一等请求记录持久化的公共 seam，因此重放可重新描述，但无法保证跨进程零重复计费或字节级相同描述。`imageRequestPricing` 是同步接口，第一次 VL 描述尚不存在时无法精确预估它将产生的文本 token，当前仍继承父 adapter 的图片计价，文本模型的预检会低估描述占用；`vl.maxTokens` 只负责给实际调用设硬上限。Client bundle 仍复制官方 preset，需由兼容检查持续监控。真实 VL 调用需要用户凭据，本轮不写入或读取明文凭据。

## 审计重点

1. 比较 rc2 与 Next 的 LLM adapter/prepared call 生命周期，证明图片重写、父 adapter dispatch、连接 generation、取消和重试的一致性。
2. 比较 Next 原生多模态、attachment、image routing 与本插件“先描述再发给文本模型”的职责，判断 gateway 是否仍有独立价值、应变成 route wrapper，还是可删除部分预处理。
3. 审计图片大小、MIME、data URI、模型输入预算、描述缓存和多图顺序；确认不会重复计费或泄漏模型不可见内容。
4. 审计 DeepSeek/Qwen endpoint、模型、API key ref、timeout、匿名 user id、launch environment 和错误脱敏。
5. 审计 Session/request 记录是否满足 Next 的 model-visible/logged 规则，并检查 replay/恢复是否完整。
6. 审计设置 schema、设置卡、凭据操作、Client store、slot、locale、保存反馈和无障碍。
7. 审计 `tsdown.config.ts` 与 `scripts/harness-paths.mjs`；尽量改用稳定公开的 Next client build contract，避免长期复制 Next 内部 inline-safe roster。
8. 审计安装脚本、build-anchor、兼容性检查和发布文件，删除只服务 rc2 的兼容路径。

## 验证要求

为每项保留/删改/新增指定测试：prepared-call generation、图片替换、多图与取消、设置热更新、凭据错误、真实 Loader 启动、Client module 加载、GUI 设置卡、模型可见请求日志，以及至少一个有凭据的真实图片描述调用。没有可用凭据时必须记录为未验证。

最后运行独立启动脚本并确认旧服务仍在。不要 push，除非用户明确要求。
