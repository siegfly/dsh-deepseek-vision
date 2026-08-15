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

`llm-vl-gateway` 也是一个 settings namespace，所以也可以在 Web Models 页 /
`settings.yaml` 里改（`deepseek` 子段由可配置 provider 目录接管展示）。

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

1. 设置两个 key（`.credentials.yaml` 由 Models 页写，或启动环境变量）；
2. Models 页选择 provider **DeepSeek + Vision**（会话内切换即持久化为默认）；
3. 聊天窗贴图，发消息——图片自动被描述，DeepSeek 看到的是文字。

## 开发

```powershell
pnpm test      # vitest；@deepseek-ai/* 经 vitest.config.ts 动态映射到本机
               # ../deepseek-harness 的 workspace 源码（仅测试时）
```

- `tsconfig.json` 的 `paths` 同样指向 `../deepseek-harness` 的 **已提交 .d.ts**（仅
  构建期类型解析）；产物里的 `@deepseek-ai/*` 导入保持裸说明符，运行时走 profile
  fallback。
- 如果官方 checkout 与本仓库不在同级目录，改 `tsconfig.json`/`vitest.config.ts`
  里的路径即可（只影响开发，不影响已安装的插件）。
- 改代码后重新 `pnpm build && pnpm install-profile`（pnpm `file:` 重新硬链接新内容）。

## 边界与注意

- **compaction**：默认继承会话 provider（即网关路由），图片被改写且命中缓存；若把
  压缩策略显式 pin 到 `deepseek-official` 且历史含图，会按原逻辑
  `UNSUPPORTED_CONTENT` 失败。
- **VL 失败语义**：默认 fail-closed——描述失败（如 key 失效）整个请求以稳定错误码
  （`AUTH`/`TIMEOUT`/`TRANSPORT`…）终止，不静默丢图；`onFailure: placeholder`
  可降级。
- 描述文本会占用 DeepSeek 的 context（每图几百 token，仅首次计费）。
- 插件不做图片降采样；超大图建议控制 `vl.timeoutMs` 并留意 VL 供应商的图片大小上限。
