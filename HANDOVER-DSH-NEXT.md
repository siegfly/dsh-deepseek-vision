# DSH Next 接手说明：DeepSeek Vision Gateway

## 接手目标

当前分支完成了 API 兼容移植和 profile 启动验证，没有完成产品级架构与功能审计。接手 Agent 需要产出并实施：

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

它通过 `link:D:\Software\GIT-next\dsh-vl-gateway` 安装到 Next profile。已验证 alpha build、46 个 focused tests 和完整 profile 启动。构建 anchor 指向 DSH `0.1.3-alpha.2`；client-runtime 已替换为 Next Client store/settings/renderer API；Host settings 使用 Next registration；prepared call 保持准备时捕获的连接 generation。

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