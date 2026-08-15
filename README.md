# dsh-vl-gateway

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

前置：本机已有 dsh 安装（本仓库的路径解析在**运行时**依赖 dsh profile 的
`profiles/node_modules` healed fallback，不依赖本仓库自己的 node_modules）。

```powershell
# 1. 构建（lib/ 已提交，此步也可省略；改了 src 后必须执行）
pnpm install        # 只装 devDeps（typescript/vitest），不会装 @deepseek-ai/*
pnpm build

# 2. 安装进 web profile（等价于 dsh plugin --profile web add file:<repo>）+ 写入 patch 行
pnpm install-profile          # 或 node scripts/install-profile.mjs [profile] [dshHome]
```

`install-profile` 做了两件事：

- `pnpm add file:<repo>`（在 `$DSH_HOME/profiles/web` 里执行）——插件被硬链接进
  profile 的 node_modules，运行时 `@deepseek-ai/*` 依赖经官方 healed fallback
  解析到**同一个** dsh 安装（共享同一个 cordis 实例，不会出现双实例问题）；
- 向 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加一行：
  ```yaml
  - insert:
      - id: llm-vl-gateway
        name: dsh-vl-gateway
  ```
  该文件是**热重载**的（config-only HMR），运行中的 `dsh web` 数秒内自动挂载插件，
  **不需要重启**。

卸载：`pnpm uninstall-profile`。

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
| `vl.model` | `qwen-vl-max` | VL 模型 id |
| `vl.describePrompt` | 详述+逐字提取的英文提示词 | 图片描述指令 |
| `vl.timeoutMs` | `120000` | 单次描述请求硬超时 |
| `vl.maxCacheEntries` | `64` | 进程内描述缓存容量（LRU） |
| `vl.onFailure` | `fail` | `fail`=描述失败整个请求失败；`placeholder`=降级为文字占位继续 |

`llm-vl-gateway` 也是一个 settings namespace，所以有三个编辑入口：**设置 → 插件 → 插件配置**
的"DeepSeek + Vision（视觉语言桥接）"卡片（`vl.*` 全字段 + VL 密钥）、Web Models 页
（`deepseek.*` 子段由可配置 provider 目录接管展示）、`settings.yaml`（两个子段都可写）。

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
          model: qwen-vl-max
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
pnpm test      # vitest；@deepseek-ai/* 经 vitest.config.ts 动态映射到本机
               # ../deepseek-harness 的 workspace 源码（仅测试时）
pnpm build     # tsc（宿主面 + 客户端面 lib/client/*.js）+ tsdown（lib/client.js
               # 浏览器 CJS 工厂包，横幅/页脚与官方 tsdown.client 预设一致，
               # 外部依赖仅平台模块，其余全部内联）
```

- `tsconfig.json` 的 `paths` 同样指向 `../deepseek-harness` 的 **已提交 .d.ts**（仅
  构建期类型解析）；产物里的 `@deepseek-ai/*` 导入保持裸说明符，运行时走 profile
  fallback。
- `tsdown.config.ts` 复刻官方 `packages/client/tsdown.client.ts` 预设的行为（该预设未
  发布）：`window.__ModuleLoader__.load({id, factory})` 闭包工厂、平台模块 external
  （react/slots/runtime/client 等由模块表解析）、其余全部内联；**不 import 官方仓库的
  任何构建文件**。
- 如果官方 checkout 与本仓库不在同级目录，改 `tsconfig.json`/`vitest.config.ts`
  里的路径即可（只影响开发，不影响已安装的插件）。
- 改代码后重新 `pnpm build && pnpm install-profile`（pnpm `file:` 重新硬链接新内容）；
  新增/变更 `dsh.client` 声明需重启 dsh web。

## 版本对齐（跨机器安装必读）

插件的运行时 `@deepseek-ai/*` 依赖从**目标机器自己的 dsh 安装**解析（healed fallback），
所以唯一的跨机器风险是"构建锚点版本 ≠ 目标安装版本"造成的 API 漂移。约定如下：

- `package.json` 的 `dshCompat.anchorVersion` 声明本发布版 `lib/` 的**构建锚点**
  （当前 `0.1.0-rc.5`，即本机 checkout 的 `apps/cli` 版本）；
- 每次发版打 tag：`v<插件版本>-dsh-rc<N>`，例如 `v0.1.0-dsh-rc5` —— tag 直接标出锚点；
- **兼容性检查**（安装时自动运行，也可单独跑）：
  ```powershell
  node scripts/check-compat.mjs [dshHome]
  ```
  读取目标机器 `$DSH_HOME/profiles/node_modules` 里 `dsh`/`dsh-llm`/`dsh-llm-deepseek`/
  `dsh-client-ui-settings-plugins` 的实际版本并对照锚点分级：完全一致=exit 0；同版本线
  不同 rc（如 rc.5→rc.6）=exit 1（大概率兼容，建议贴图冒烟一次）；版本线不同=exit 2
  （必须重建）。fallback 目录不存在（dsh web 还没启动过）时给出提示。

**目标机器与锚点不一致时重建**（例如官方 `npx @deepseek-ai/dsh web` 装到了新 rc）：

1. 在目标机器拿到对应版本的官方源码：`git clone --branch <对应tag> https://github.com/deepseek-ai/deepseek-harness`（或用该机器 npx 缓存里的 `lib/types`）；
2. 把本仓库 `tsconfig.json` / `vitest.config.ts` 里的 `../deepseek-harness` 路径改指到它；
3. `pnpm install && pnpm build && pnpm test`，然后 `node scripts/install-profile.mjs`；
4. 把 `dshCompat.anchorVersion` 更新为新的锚点并打对应 tag。

## 边界与注意

- **compaction**：默认继承会话 provider（即网关路由），图片被改写且命中缓存；若把
  压缩策略显式 pin 到 `deepseek-official` 且历史含图，会按原逻辑
  `UNSUPPORTED_CONTENT` 失败。
- **VL 失败语义**：默认 fail-closed——描述失败（如 key 失效）整个请求以稳定错误码
  （`AUTH`/`TIMEOUT`/`TRANSPORT`…）终止，不静默丢图；`onFailure: placeholder`
  可降级。
- 描述文本会占用 DeepSeek 的 context（每图几百 token，仅首次计费）。
- 插件不做图片降采样；超大图建议控制 `vl.timeoutMs` 并留意 VL 供应商的图片大小上限。
