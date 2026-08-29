# AI 图片生成插件

`@vendure/image-generation-plugin` 把中转站的生图能力、自有提示词 Skill、邀请返利余额结算、私有图片存储和前后台页面组合成一个 Vendure 插件。

## 用户功能

- 文字生图，以及单张 JPEG、PNG 或 WebP 参考图生图。
- 参考方式：按描述编辑、保持商品、保持成年人物身份、参考风格、参考构图。
- 可选 1:1、3:4、4:3、9:16、16:9，以及模型原生支持的 1K、2K、4K，每次 1–4 张。
- 免费智能优化描述，用户可继续编辑或一键恢复原文。
- 根据任务自动推荐模型，也允许用户手动选择。
- 历史记录、下载、删除单张图或整个已结束任务、再次创作、取消尚未执行的单张任务。

前台入口是客户端插件位 `BUSINESS_SERVICES_MAIN`，页面路由为 `/image-studio`。客户端永远不会获得中转站 API Key、中转站基础地址或内部模型 ID。

## 上线模型

| 前台名称               | 官方模型 ID              | 默认协议                 | 自动推荐场景                   |
| ---------------------- | ------------------------ | ------------------------ | ------------------------------ |
| Codex 图片 1           | `gpt-image-1`            | `OPENAI_RESPONSES_IMAGE` | 商品场景、社交配图             |
| Codex 图片 1.5         | `gpt-image-1.5`          | `OPENAI_RESPONSES_IMAGE` | 精细编辑、商品抠图、透明背景   |
| Codex 图片 2           | `gpt-image-2`            | `OPENAI_RESPONSES_IMAGE` | 身份一致性、准确文字、复杂版式 |
| Gemini 3.1 Flash Image | `gemini-3.1-flash-image` | `GEMINI_NATIVE_STREAM`   | 快速试稿、插画、性价比优先     |

管理员可为每个模型改写中转站实际模型 ID、调用协议、中英文名称与用途说明、排序，以及 1K、2K、4K 的独立单张售价。这些说明会显示在客户选择模型的卡片上。同一店铺启用的模型必须使用同一币种，避免客户余额与模型价格错配。2K/4K 价格为 0 时客户端不开放该档。

当前站点接入的是订阅账号中转，不是官方按量 API Key。后台“中转站调用方式”会按模型类型过滤：Codex 图片只显示 Codex/OpenAI 兼容方式，Gemini 图片只显示 Gemini 兼容方式。当前 Codex 订阅中转应选择“订阅中转：Responses 生图”，Gemini 订阅中转应选择“订阅中转：流式 Gemini 生图”。

清晰度不是前端标签或后期放大：服务端把所选档位写入上游模型请求，并在结算前检查返回图片的真实像素。中转站忽略参数或返回低于所选档位的图片时，该张任务失败并退回费用。旧版 `gpt-image-1`、`gpt-image-1.5` 只开放 1K；`gpt-image-2` 开放 1K/2K，4K 仅支持 9:16 与 16:9；Gemini 3 图片模型通过原生协议开放 1K/2K/4K。

## 中转站接入

超级管理员在“系统 → AI 生图接入”分别设置 OpenAI 与 Gemini 的 HTTPS 基础地址、API Key 和文本模型 ID。OpenAI 的文本模型同时用于提示词优化和 Responses 图片工具编排，实测可用 `gpt-5.4-mini`；图片工具内的模型仍是各模型卡配置的图片模型。提示词优化优先使用健康的 OpenAI Key，OpenAI 不可用时自动尝试健康的 Gemini 提示词 Key，两者都不可用时使用本地规则兜底。生图凭证按模型协议自动路由。API Key 使用 AES-256-GCM 加密后入库，后台只回显末四位。

适配器支持：

- `OPENAI_RESPONSES_IMAGE`：`/responses` 中的 `image_generation` 工具，是当前中转站账号已验证的 GPT 生图方式。
- `OPENAI_IMAGES`：`/images/generations` 和 `/images/edits`。
- `OPENAI_COMPATIBLE_CHAT`：`/chat/completions`，支持返回 base64、data URL 或公网图片 URL。
- `GEMINI_INTERACTIONS`：`/interactions`，用于当前 Gemini 图片模型，支持文字和参考图输入。
- `GEMINI_NATIVE`：`/models/{model}:generateContent`，保留给只支持同步接口的中转站。
- `GEMINI_NATIVE_STREAM`：`/models/{model}:streamGenerateContent?alt=sse`，用于可能超过边缘同步超时的 Gemini 生图请求。

Codex 图片请求固定传 `quality: "medium"`。`OPENAI_RESPONSES_IMAGE`、`OPENAI_IMAGES` 文字生图和 `OPENAI_IMAGES` 参考图编辑使用相同质量，避免因省略质量参数而退回 `auto`，导致成本和成品档位不稳定。

中转站返回的图片最大 25MB。远程图片 URL 默认禁用；如果中转站不返回内联图片，必须在 `IMAGE_GENERATION_REMOTE_IMAGE_HOSTS` 中设置精确域名白名单。下载时会固定已验证 DNS 结果，并拒绝内网、本机、云元数据地址及 HTTP 重定向；生产环境只允许 HTTPS。

每个模型都可执行“只读测试”和明确需要确认的“付费生图测试”。只读测试优先读取单模型元数据，再回退到模型列表；不会发起生图。健康状态不会按时间过期；修改 API Key、基础地址、文本模型 ID、中转站模型 ID 或协议会立即清空对应旧状态，401/403 或连续真实调用失败也会把 Key 标记为不可用，429 只进入临时冷却。

## 提示词 Skill

自有 Skill 位于 `skill/image-prompt-pro`。它参考了 Apache-2.0 或 MIT 授权的公开项目原理，来源和许可证记录在 `THIRD_PARTY_NOTICES.md`。

运行时不会执行 `SKILL.md` 或网上下载的代码。构建步骤把已审核的 JSON 规则编译成带 SHA-256 的纯 JSON bundle，并同步生成内容完全相同的静态 TypeScript 数据模块，以兼容 Vendure Dashboard 的临时编译目录。服务端只读取这份已编译数据。每个生图任务都会保存 Skill hash，方便追溯。

后台可在已发布 bundle 之间回滚。激活状态保存在数据库中，每个 API 实例在处理图片工坊请求前会同步当前版本，多实例部署无需依赖单机内存状态。`bundleVersion` 是规则数据格式版本，不是发布序号；后台用创建日期和短 SHA-256 区分每次发布。

插件默认使用手动激活。设置 `IMAGE_PROMPT_SKILL_AUTO_ACTIVATE=true` 后，只有当前进程首次发现的新哈希会自动成为当前版本；旧进程重启不会把历史 bundle 重新激活。历史版本始终保留，可在后台手动回滚。仓库内受管生产发布会在 API 和 Worker 进程中默认打开此开关，并允许通过加密 `.env` 显式设置为 `false` 暂停自动激活。

智能优化流程：

1. 本地规则先生成稳定的结构化兜底结果。
2. 调用同一中转站的文本模型，只接收严格 JSON。
3. 结构不合格时最多修复一次，仍失败就使用本地兜底，不阻塞用户。
4. 保留用户指定的文字、商品特征和参考图约束，不自行编造品牌、价格、认证、功效或身份。

提示词优化对客户免费，但平台仍需承担文本模型 API 成本；默认限额是每分钟 3 次、每个北京日 20 次。

## 费用与可靠性

- 2026-08-28 中转站账号测试：`gpt-image-1`、`gpt-image-1.5`、`gpt-image-2` 均通过 `/responses` 图片工具成功返回 PNG。当前用户 Key 的历史 `/responses` 图片记录按张扣 `$0.150000`；三个图片模型仍需分别用生产 Key 生成后复核中转站是否采用相同按张价。
- 2026-08-28 Gemini 中转站实测：`gemini-3.1-flash-image` 通过 Antigravity 原生流式接口成功返回图片，两次成功账单分别为 `$0.004410` 和 `$0.004672`。同步接口可能触发边缘 504，因此生产配置使用流式协议。
- 上线定价必须预留失败重试、免费提示词优化、汇率波动和运维利润；管理后台可分别调整每个模型的 1K、2K、4K 单张售价。

- 提交时按“单价快照 × 张数”从邀请返利 `availableBalance` 原子预占。
- 每张图使用独立输出记录和幂等键。图片已写入私有存储后才结算；失败或取消仅退回本张。
- 数据库交易内同时写入队列出站记录，即时入队失败会由定时任务补发；连续 15 分钟无法入队则失败并退回本张费用。
- 中转站 429 最多重试 2 次。超时或网络结果不确定时进入 `UNKNOWN`，不盲目重试；15 分钟仍无法确认就自动退回本张费用。
- 只有管理员明确标记“中转站保证幂等”的模型，才能用原幂等键重试 `UNKNOWN` 输出。更换 Key 或 Base URL 后也禁止重试旧任务。
- 每次真实调用都记录模型、请求号、HTTP 状态、耗时和中转站返回的成本/用量字段。后台提供 30 天成本对账；如果中转站不返回成本，会显示为“缺失成本”，不会猜测。
- 队列并发默认为 2。后台定时修复中断的结算，每小时清理过期私有图片。

## 保留与安全边界

- 参考图最大 10MB / 4000 万像素。未提交的参考图上传后保留 24 小时；已被任务使用的参考图会保留到最后一个关联任务终止，之后再保留 24 小时。
- 参考图会重编码以清除 EXIF/GPS 元数据。每个客户限制每分钟 5 张、每日 30 张、最多 10 张有效参考图且总计不超过 100MB。
- 生成图默认保留 90 天，通过 5 分钟有效的签名链接预览或下载。
- 免费提示词优化记录保留 30 天；已结束任务中的提示词和请求号 90 天后自动脱敏。客户也可以立即删除整个已结束任务。
- 允许普通成年人像；拒绝欺骗性公众人物换脸、未成年人敏感内容、非自愿私密内容和去除水印/来源标记。
- 本地规则是第一层防护，生产中仍必须启用中转站或上游模型的安全审核，并建立投诉与人工复核流程。

## 环境变量

```dotenv
IMAGE_GENERATION_STORAGE_ROOT=/srv/vendure/image-generation-private
IMAGE_GENERATION_DOWNLOAD_SECRET=<at-least-32-random-characters>
IMAGE_GENERATION_MASTER_KEY=<at-least-32-random-characters>
# 可选：仅当中转站返回远程图片 URL 时配置精确域名，多个用逗号分隔
IMAGE_GENERATION_REMOTE_IMAGE_HOSTS=
# 可选：新 Skill bundle 随代码部署后自动激活；默认 false
IMAGE_PROMPT_SKILL_AUTO_ACTIVATE=false
```

生产的存储路径必须是持久化绝对路径。API 和 worker 分开部署时，两者必须使用同一份持久化挂载和相同密钥。密钥轮换前必须先制定已有 API Key 重加密方案，直接更换主密钥会导致旧密文无法解密。

签名图片 URL 使用同源相对路径。如果前台静态站和 Vendure API 分开部署，网关必须把 `/image-generation/private/*` 原样反向代理到 Vendure API，并禁止 CDN 公共缓存该路径。

## 启用顺序

1. 运行全部待执行数据库迁移，并确认最新的 `1787846400000-add-image-resolution-pricing` 已完成。
2. 配置上述环境变量，确保 API/worker 共享存储和密钥。
3. 超级管理员配置中转站并执行“测试连接”。
4. 店铺管理员设置模型协议、中转站模型 ID、用途说明、1K/2K/4K 单价和默认模型，执行“保存并测试”后再开启功能。
5. 确认返利计划允许余额消费，并用测试客户跑通“预占→成功结算/失败退回”。
6. 在客户端插件配置中启用“AI 图片工坊”入口。

## 上线前真实中转站联调

代码库的 E2E 使用模拟中转站，不会消耗真实 API 额度。发布到预生产后，还需使用你自己的中转站 Key 完成以下检查：

1. 分别对每个启用模型执行“保存并测试”，确认中转站模型 ID 与协议匹配。
2. 每种协议至少生成一张 1:1 和一张非方形图；对已定价的 1K、2K、4K 分别核对实际像素、中转站 request ID 和账单。
3. 对支持参考图的模型各跑一次商品保持和描述编辑，确认中转站接受 multipart 或内联 base64。
4. 用测试客户核对“提交时预占、成功逐张扣费、失败逐张退回、人工退款”与中转站账单一致。
5. 主动模拟 429、500 和超时，确认只有 429 自动重试，超时进入 `UNKNOWN` 且 15 分钟后退回。
6. 确认 API 和 worker 使用同一 `IMAGE_GENERATION_MASTER_KEY`、下载签名密钥和私有存储挂载，并检查网关没有公开缓存签名图片。
7. 根据真实单张成本、汇率、重试率和利润率确定前台售价，并启用上游安全审核与投诉处理流程。

## 本地检查

```bash
bun run --cwd packages/image-generation-plugin test:skill
bun run --cwd packages/image-generation-plugin test
bun run --cwd packages/image-generation-plugin test:e2e
bun run --cwd packages/image-generation-plugin check-types
bun run --cwd packages/image-generation-plugin build
node packages/dev-server/scripts/production-env-readiness.spec.mjs
```

不配置真实中转站 Key 时，可以验证编译、接口、帐务和适配器解析，但不能代替上线前的真实中转站联调。
