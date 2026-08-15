# dsh-vl-gateway

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
[![](https://img.shields.io/badge/license-MIT-green?style=flat-square)](./LICENSE)

给 DeepSeek Harness 的**外部 provider 插件**：一个"网关"模型路由，让纯文本的
DeepSeek 编程模型无缝支持聊天窗贴图。

> 本仓库是独立 git 仓库，与 deepseek-harness 官方仓库没有任何 git 关系
> （无 fork/子模块/远程关联）。它只在本机通过 pnpm 的 `file:` 依赖安装进
> dsh profile，官方 checkout 零改动。

## 效果

聊天窗里选中 `DeepSeek + Vision` 这个 provider（比如 `deepseek-v4-flash` 或
`deepseek-v4-pro`），之后：

- 在聊天窗**粘贴/拖入图片** → 被配置好的视觉模型（默认 Qwen-VL）先描述成文字
  （逐字提取代码、报错、日志、UI 文案，并描述布局）；
- 描述文字替代图片发给 DeepSeek → 你继续用 DeepSeek 写代码，同时获得图片理解能力；
- 每张图片只描述一次（按 attachmentId 进程内缓存），重试、上下文压缩、后续轮次
  都复用同一份描述，不重复计费；
- session 日志仍然持久化原始图片，历史/回放/重构不变量不受影响。

## 原理（为什么是"网关适配器"而不是中间件）

DSH 的消息协议原生支持图片：贴图会先经 apiproxy 的 `prompt` RPC 持久化为
`ImageBlock` 存进 session log，再由 adapter 翻译成 provider wire 格式。但有两道
硬门槛：

1. **入场拒绝**：`prompt`/`selectModel` RPC 检查当前模型的 `inputModalities`，
   不含 `image` 时贴图直接被拒（`MODEL_DOES_NOT_SUPPORT_IMAGES`）——纯
   `llm/stream` 中间件拦不到这一步。
2. **序列化拒绝**：llm-deepseek 的序列化器对 image block 抛 `UNSUPPORTED_CONTENT`。

因此本插件注册一个**新的 provider 路由**（默认 `deepseek-vision`），继承官方导出
的 `DeepSeekAdapter`：

- `resolveModel()`/`listModels()` 声明 `inputModalities: ['text','image']`
  （真实声明——网关确实消费图片）→ 贴图被放行；
- `stream()` 里把请求中的图片块（含 tool-result 嵌套）经 VL 模型改写为文本描述，
  再 `yield* super.stream(...)` 走原汁原味的 DeepSeek wire；
- reasoning efforts / context 窗口 / 默认 maxTokens / retry policy 全部从父类继承。

副作用收益：`tool-fs read_image`、浏览器截图工具同样以 `inputModalities` 为门槛，
选中网关路由后它们也可用，工具结果里的嵌套图片同样被改写。

## 安装

安装走**官方 bundle 机制**（与 `dsh plugin add` 完全相同）：本包在 `package.json`
里声明 `dsh.bundle.patch`（指向包内附带的 `cordis.patch.yml`），安装时把包链接进
profile 并把包名对账进 profile manifest 的 `dsh.profile.bundles` 层栈，loader 启动
时按层挂载——**不需要手工往 `cordis.patch.yml` 加任何行**（旧版本加过的受管块会在
下次安装/卸载时自动迁移移除）。

前置：目标机器已有 dsh 安装并**启动过一次**（本仓库的路径解析在**运行时**依赖 dsh
profile 的 `profiles/node_modules` healed fallback，构建/测试的类型与运行时入口也优先
从它取，**不需要官方源码 checkout**）；PATH 里有 `pnpm`（`dsh plugin add` 同样要求）；
Node 22.19+ 或 24+（与官方 dsh 相同）；首次 `pnpm install` 需联网拉 devDeps（typescript/vitest/tsdown，不含任何
`@deepseek-ai/*`）。已在 fresh clone（无 checkout、无 harness-paths.json）上验证：
`pnpm install → build → test → check-compat` 全绿；并针对**比锚点更新的官方版本**
（npm 最新 `dsh@0.1.0-rc.6`）做过全链路验证：构建 / 54 测试通过（2 个客户端套件按
设计跳过，见"开发"）/ `check-compat` exit 1 提示放行 / 安装成功（见"版本对齐"）。

```powershell
# 方式 A（推荐，官方 CLI 在 PATH 时）：与官方插件安装完全相同的路径，
# spec 支持官方文档列出的全部形式（npm 包名 / git spec / 本地目录 / 本地 tarball）
dsh plugin --profile web add dsh-vl-gateway                              # npm（发布后）
dsh plugin --profile web add github:<you>/dsh-vl-gateway#<commit-sha>    # git，锁 commit
dsh plugin --profile web add file:<本仓库路径>                           # 本地目录（开发）
dsh plugin --profile web add ./dsh-vl-gateway-0.1.0.tgz                  # tarball（无 git/网络）

# headless profile 同样支持（dsh run 默认用 headless；client 卡片只在 web 生效）
dsh plugin --profile headless add dsh-vl-gateway

# 方式 B（无 CLI 时）：本仓库脚本等价复刻方式 A（init 布局 → pnpm add → bundles 对账）
pnpm install        # 只装 devDeps（typescript/vitest），不会装 @deepseek-ai/*
pnpm install-profile          # 或 node scripts/install-profile.mjs [profile] [dshHome]
```

两种方式做同样的事：

- 把 `dsh-vl-gateway` 链接进 profile 的 node_modules（运行时 `@deepseek-ai/*` 依赖经
  官方 healed fallback 解析到**同一个** dsh 安装，共享同一个 cordis 实例，不会出现
  双实例问题）；
- 把 `dsh-vl-gateway` 对账进 profile manifest 的 `dsh.profile.bundles`——loader 按层
  挂载包内 `cordis.patch.yml` 的 insert 行（注册路由 + 设置段）；旧版写在 profile 自身
  `cordis.patch.yml` 里的受管块会被自动移除迁移，绝不双挂载；
- 首次安装时如 profile 布局缺失，按官方 `initProfile` 语义补齐（manifest + 空用户
  patch 层 + `pnpm-workspace.yaml`），**已存在的文件从不改动**。

装完**重启一次 `dsh web`**（bundles 层栈变化 + 客户端模块扫描按包名缓存，首次安装
必须重启）。卸载：`pnpm uninstall-profile`（或 `dsh plugin --profile web remove
dsh-vl-gateway`）。

## 配置

插件的 patch 行可以带 `config`，也可以完全省略走默认值。两个 key 都支持
credential-ref（环境变量名），凭据经 dsh 的 credentials seam 解析（Web Models 页
写入的凭据即可用），无 seam 时回退到启动环境变量：

| 路径 | 默认值 | 说明 |
| --- | --- | --- |
| `provider` | `deepseek-vision` | 注册的路由 id（避开 `deepseek-official`） |
| `displayName` | `DeepSeek + Vision` | 模型选择器里的名字 |
| `deepseek.*` | — | 与官方 `llm-deepseek` 段完全同构（apiKeyEnv/baseURL/thinking/reasoningEffort/maxTokens/models/retryPolicy…） |
| `deepseek.apiKeyEnv` | `DEEPSEEK_API_KEY` | DeepSeek key |
| `vl.apiKeyEnv` | `QWEN_VL_API_KEY` | VL 模型 key |
| `vl.baseURL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 任意 OpenAI 兼容 `/chat/completions` 网关 |
| `vl.model` | `qwen3-vl-flash` | VL 模型 id（百炼最新代 flash 档；贴图 OCR 型描述性价比最高。复杂视觉推理可换 `qwen-vl-max`） |
| `vl.describePrompt` | 详述+逐字提取的英文提示词 | 图片描述指令 |
| `vl.timeoutMs` | `120000` | 单次描述请求硬超时 |
| `vl.maxCacheEntries` | `64` | 进程内描述缓存容量（LRU） |
| `vl.onFailure` | `fail` | `fail`=描述失败整个请求失败；`placeholder`=降级为文字占位继续 |

`llm-vl-gateway` 也是一个 settings namespace，所以有三个编辑入口：**设置 → 插件 → 插件配置**
的"DeepSeek + Vision（视觉语言桥接）"卡片（`vl.*` 全字段 + VL 密钥）、Web Models 页
（`deepseek.*` 子段由可配置 provider 目录接管展示）、`settings.yaml`（两个子段都可写）。

`provider` / `displayName` 是**注册期事实**：在 `settings.yaml` 或设置段里修改会即时生效
——插件把两个注册表（adapter 路由 + 可配置 provider 目录）原子重注册，不需要重启；
改成别的插件已占用的路由 id 时两个注册表都保留旧值并在日志里说明原因（被拒的更新不
会静默）。

示例（cordis.patch.yml 行内配置，全部可选）：

```yaml
- insert:
    - id: llm-vl-gateway
      name: dsh-vl-gateway
      config:
        deepseek:
          reasoningEffort: high
        vl:
          apiKeyEnv: DASHSCOPE_API_KEY
          model: qwen3-vl-flash
```

## 使用

1. 设置两个 key：**设置 → 插件 → 插件配置 → "DeepSeek + Vision（视觉语言桥接）"** 卡片里直接填 VL 密钥（写入凭据存储，不出现在任何响应/设置里）；DeepSeek key 沿用现有凭据；
2. Models 页选择 provider **DeepSeek + Vision**（会话内切换即持久化为默认）；
3. 聊天窗贴图，发消息——图片自动被描述，DeepSeek 看到的是文字。

插件配置页的这张卡片是本插件的**客户端面**（`dsh.client`）：以官方解耦插件的方式注册进
`settings.plugin.item` 槽位，编辑 `llm-vl-gateway.vl` 段（端点 / 模型 / 描述提示词 / 超时 /
缓存 / 失败策略 / 密钥），与官方内置卡片（终端 / Agent 循环 / 网页搜索）同机制、同交互
（暂存草稿、显示覆盖状态、保存时整体写入）。首次启用客户端面需要**重启一次 dsh web**
（官方客户端模块扫描按包名缓存，新声明在重启时生效）。

## 开发

```powershell
pnpm test      # vitest；@deepseek-ai/* 经 vitest.config.ts + scripts/harness-paths.mjs
               # 解析到 harness 类型/源码（仅测试时）
pnpm build     # harness-paths --write（生成 tsconfig.paths.json，gitignored）
               # + tsc（宿主面 + 客户端面 lib/client/*.js）+ tsdown（lib/client.js
               # 浏览器 CJS 工厂包，横幅/页脚与官方 tsdown.client 预设一致，
               # 外部依赖仅平台模块，其余全部内联）
```

- **harness 类型从哪来**（`scripts/harness-paths.mjs`，仓库内唯一的解析缝，不硬编码任何
  路径）按序取一个：`$DSH_CHECKOUT` 环境变量（指向官方源码 checkout）→ 本仓库根目录
  的 `harness-paths.json`（`{"checkout": "<路径>"}`，gitignored，机器私有）→ 本机**已
  安装的 dsh**（`$DSH_HOME/profiles/node_modules` healed fallback，自带提交的
  `lib/types/*.d.ts`，`npx @deepseek-ai/dsh web` 的机器同样适用）。三者都没有时构建/
  测试会给出指引并停止。
- 产物里的 `@deepseek-ai/*` 导入保持裸说明符，运行时走 profile fallback —— 类型解析
  缝只影响开发，不影响已安装的插件。
- **纯 npm 机器上的测试面**：npm 发布的官方客户端包只在浏览器闭包里携带客户端运行时
  （`lib/types/client` 仅有声明、无可执行 JS），Node 无法执行官方客户端运行时（官方自己
  的客户端测试同样需要源码 checkout）。因此纯 npm 机器上 2 个客户端测试套件会**自行跳过**
  （`tests/support/client-runtime.ts` 判定），其余 54 个照常运行；有官方源码 checkout 的
  机器（开发机 / CI）跑全 66 个。
- `tsdown.config.ts` 复刻官方 `packages/client/tsdown.client.ts` 预设的行为（该预设未
  发布）：`window.__ModuleLoader__.load({id, factory})` 闭包工厂、平台模块 external
  （react/slots/runtime/client 等由模块表解析）、其余全部内联；**不 import 官方仓库的
  任何构建文件**。
- 改代码后重新 `pnpm build && pnpm install-profile`（pnpm `file:` 重新硬链接新内容）；
  新增/变更 `dsh.client` 声明需重启 dsh web。

## 版本对齐（跨机器安装必读）

插件的运行时 `@deepseek-ai/*` 依赖从**目标机器自己的 dsh 安装**解析（healed fallback），
且 `install-profile` 在检查之前会**先在目标机器上用目标机器自己的 dsh 类型重新构建**
插件。因此：**本插件的发布版不锁定任何官方版本**——目标机器用比锚点更新（或更旧）的
官方 dsh 都可以安装；构建成功本身就是兼容性证明。若新官方版改了本插件用到的 API，
构建会自然失败并给出明确的 tsc 错误，那时才需要发新版适配。**作者无需跟随官方每次
升级重新发布。**

- `package.json` 的 `dshCompat.anchorVersion` 只声明本发布版提交的 `lib/` 的**构建出处**
  （当前 `0.1.0-rc.5`，即本机 checkout 的 `apps/cli` 版本），是出处声明而非安装许可；
- **构建戳让出处无法撒谎**：`pnpm build` 末尾把实际解析到的 harness dsh 版本盖进提交的
  `lib/build-anchor.json`。check-compat 对戳的判定：
  - 戳存在且 = 锚点 → OK；
  - 戳存在但 ≠ 锚点 → 提示（目标机重建后属**预期现象**：戳记录的是该机器自己的 dsh）；
  - 戳缺失 → exit 2，**拒绝安装**（发布物从未构建过，是残缺发布；`install-profile`
    本来就先构建，所以正常安装流程不会走到这里）。
- 每次发版打 tag：`v<插件版本>-dsh-rc<N>`，例如 `v0.1.0-dsh-rc5` —— tag 只是冻结的
  历史标签，不随官方更新，**也不需要**随官方更新。
- **兼容性检查**（安装时自动运行，也可单独跑）：
  ```powershell
  node scripts/check-compat.mjs [dshHome]
  ```
  读取目标机器 `$DSH_HOME/profiles/node_modules` 里 `dsh`/`dsh-llm`/`dsh-llm-deepseek`/
  `dsh-client-ui-settings-plugins` 的实际版本并对照锚点分级：完全一致=exit 0；**任何
  不一致（同线不同 rc、甚至不同版本线）=exit 1 提示并放行**。fallback 目录不存在
  （dsh web 还没启动过）时给出提示。

  `install-profile` 以这次检查为准绳：**exit 2/3 拒绝安装**（残缺发布/复刻漂移不会替换
  掉在用的好构建；`DSH_VL_GATEWAY_FORCE=1` 可强制），exit 1 放行并保留冒烟提示。
  保守用户可设 `DSH_VL_GATEWAY_STRICT=1`，此时 exit 1 也拒绝安装。

  此外，当本机有官方源码 checkout（`$DSH_CHECKOUT` 或 `harness-paths.json`）时，检查还会
  把本仓库 `tsdown.config.ts` 里**冻结复刻**的客户端 bundle 预设（模块表外部依赖清单、
  purity 正则、`__ModuleLoader__` 交接横幅/页脚）diff 到 checkout 里的官方预设——官方
  预设未发布，版本号对比看不出这些内容的漂移（新平台模块被内联=双实例风险；purity
  门禁变化=交叉导入失控）。不一致时 exit 3，先更新复刻再重建。（这是唯一会要求作者
  跟进的官方变更——它只发生在客户端打包预设上，且 checkout/CI 能提前发现。）

**何时才需要重新发布**：只有两种情况——① 新官方版改了本插件用到的 API，导致目标机
构建失败（改代码适配后发新版）；② 官方客户端 bundle 预设漂移（更新冻结复刻后重建
发新版）。单纯"官方升级了版本号"不是重新发布的理由，目标机会自动按自己的 dsh 重建。

## 边界与注意

- **compaction**：默认继承会话 provider（即网关路由），图片被改写且命中缓存；若把
  压缩策略显式 pin 到 `deepseek-official` 且历史含图，会按原逻辑
  `UNSUPPORTED_CONTENT` 失败。
- **VL 失败语义**：默认 fail-closed——描述失败（如 key 失效）整个请求以稳定错误码
  （`AUTH`/`TIMEOUT`/`TRANSPORT`…）终止，不静默丢图；`onFailure: placeholder`
  可降级。
- **图片上限 fast-fail**：描述前按部署图片准入上限（`ctx.attachments.imageLimits`）预检，
  超限图片在 base64 编码前就以稳定错误码 `IMAGE_TOO_LARGE` 失败（`placeholder` 策略下
  降级为文字占位），不把几 MB 的 data URL 送进 VL 端点再死。插件不做图片降采样（官方
  seam 没有公开的降采样能力）；部署上限内的图片仍可能超过 VL 供应商自己的大小上限，
  建议控制 `vl.timeoutMs` 并留意供应商文档。
- 描述文本会占用 DeepSeek 的 context（每图几百 token，仅首次计费）。
