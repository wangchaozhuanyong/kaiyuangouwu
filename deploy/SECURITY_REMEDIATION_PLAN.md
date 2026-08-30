# 安全与生产修复计划

最后更新：2026-08-22

本计划不包含美工审计，也不把未选定的支付服务商当成已接入能力。所有数量以当次 `bun.lock` 和构建日期为准，每次依赖变更后重新计算。

## 当前基线

- 完整 monorepo 的 `bun audit` 已从修复前的 272 条公告降为 0；冻结锁文件安装通过，未使用忽略公告或漏洞豁免。
- 已协调升级 Angular `21.2.20`、Lerna `10.0.0`、Nx `23.1.1`、esbuild `0.28.2`、SWC `1.16.0`、TypeScript `5.9.3`、typescript-eslint `8.67.0`、`brace-expansion@5.0.9` 与 `less@4.9.0`，并完成 Admin UI、Dashboard、Storefront、Server、Worker 的全仓构建、测试与变更文件 lint。
- `image-size` 已从业务代码、依赖清单和 `bun.lock` 完全移除；图片尺寸读取统一改由 Sharp 处理，并保留输入大小、像素上限、异常文件和格式拒绝测试。
- 2026-08-22 本机演练产物 `df0cc1bbca256d5d8c7427c5804b56aa195e1da5-20260822T093344Z-darwin-arm64-dirty` 包含 1,332 个已安装包和 87,138 个普通文件；文件、符号链接、包清单、SHA-256、模块加载与安全报告校验全部通过，实际目录不包含 `esbuild`、`less`、`tar`、`typescript`、`vite`、`webpack`、Angular 或 Nx。该产物是 `darwin/arm64`、源码工作区不干净，只能作为诊断证据，不能部署到 EC2。
- 该产物使用 High+ 阻断策略，`RUNTIME-AUDIT.json` 结果为 0 Critical、0 High、0 Moderate、0 Low；生产产物生成器的默认门禁已提升为 High+。

## 优先级与状态

| 优先级 | 项目                            | 当前状态                                               | 放行条件                                                                   |
| ------ | ------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| P0     | 生产运行与开发/构建依赖隔离     | 代码与手册已完成；待 Linux 正式产物和 EC2 切换         | 干净 `linux/x64` 产物自验证通过，PM2 直接运行 `dist`，线上不含六类构建工具 |
| P0     | 支付/退款失败关闭               | 已实施                                                 | 未配置真实处理器时不能正式结账；未关联真实退款时不能完成正金额售后         |
| P0     | 真实支付、回调、退款、对账      | 阻塞：尚未选定服务商/收款主体                          | 必须有正式沙箱和商户资料，不使用 dummy 支付替代                            |
| P1     | 服务端框架安全升级              | Nest、Apollo 5、Sharp 已升级；`image-size` 已移除      | 预发布迁移回放、Shop/Admin API 与真实文件上传 E2E 全部通过                 |
| P1     | Dashboard/Admin UI 与构建链升级 | Angular、Apollo Client、Vite、esbuild、Nx/Lerna 已完成 | 预发布回归管理流程与 CSP                                                   |
| P1     | 运行产物依赖瘦身                | 本地已完成；待 Linux 正式产物复验                      | 运行包不含六类构建工具，模块加载、静态 Dashboard、邮件和业务 E2E 通过      |
| P1     | 运行产物的持续漏洞扫描          | 本地与手动 Linux CI 的 High+ 门禁已完成                 | CI 保存 `RUNTIME-AUDIT.json`，High 和 Critical 阻断发布                    |
| P2     | Nginx HTTP/2 语法               | 已核对生产机为 Nginx 1.24.0，保留 `listen ... http2`   | 生产机 `nginx -t` 通过；升级至 1.25.1+ 后再评估切换为 `http2 on`           |

## P1 建议分批

### 第一批：API/Worker 真实运行依赖

1. 已升级 TypeORM `0.3.31`、Nest `11.2.1`、Apollo Server `5.5.0`、Nest GraphQL/Apollo `13.4.4`、Sharp `0.35.3` 和 `http-proxy-middleware` `3.0.7`；全仓构建、测试以及 Apollo 5 E2E 已通过。正式放行前仍需在预发布 MySQL/MariaDB 上重放迁移，回归订单查询、售后、搜索索引和 Channel 隔离。
2. Apollo 5 使用官方 Express 5 集成，Shop/Admin API 的启动、认证与 GraphQL E2E 已通过；预发布仍需覆盖限流、查询复杂度、错误响应、认证 Cookie 与长时间 Worker 任务。
3. Sharp 已完成升级和图片转换兼容修复；`image-size` 已移除，图片元数据读取由 Sharp 的受限入口统一处理。正式验收仍要覆盖 JPG/PNG/WebP/AVIF、异常文件、超限文件与并发上传。
4. production runtime 构建会生成 `RUNTIME-PACKAGES.json` 和 `RUNTIME-AUDIT.json`，按真实版本与路径扫描，并将 High 设为默认硬阻断。后续每批仍需重复该检查，不能只看完整 monorepo 的数量。
5. `Production Runtime Artifact` 手动工作流只接受 `origin/main` 当前完整 SHA，固定 Linux x64、Node 和 Bun 版本，并在上传保留符号链接的归档前重复全仓与运行产物门禁；工作流制品只保留 7 天，不能替代正式发布记录和服务器复验。

### 第二批：Dashboard/Admin UI 与工具链

1. Legacy Admin UI 已迁移至 Angular `21.2.20`、Apollo Angular `13.0.0` 和 Apollo Client `4.2.3`；Angular library、production app 与 166 项测试通过。
2. Vite 已升级到 `7.3.6`，esbuild 已升级到 `0.28.2`，并通过 Dashboard/Storefront 构建。生产 EC2 继续禁止运行任何 Vite/esbuild dev server。
3. Lerna `10.0.0`、Nx `23.1.1`、SWC `1.16.0`、TypeScript `5.9.3`、`brace-expansion@5.0.9` 和 `less@4.9.0` 已完成协调升级；构建工具仍只保留在构建机，不进入生产运行目录。
4. 空缓存构建暴露的 `ui-devkit` Rollup 问题已修复：resolver 显式支持 `.ts`，旧 TypeScript 插件使用明确的 `include: ['**/*.ts']`。目标包构建与全仓 25 项目构建均已通过。

### 第三批：运行依赖瘦身与扫描

1. 生产产物生成器会按实际安装闭包精确移除 `esbuild`、`less`、`tar`、`typescript`、`vite` 和 `webpack`，随后执行模块加载、必需静态资源、包清单、审计报告和 SHA-256 完整性验证；任何被禁包残留都会使生成失败。
2. 对 `RUNTIME-PACKAGES.json` 生成 CycloneDX/SPDX SBOM，使用固定版本的扫描器在 CI 中按实际安装版本阻断 Critical 和经判定可利用的 High；保存扫描器版本、公告库时间和豁免到期日。
3. 已清除完整 monorepo 和运行产物的全部已知公告命中；依赖变更必须继续重复冻结安装、全仓审计和 High+ 产物门禁。

## 真实支付待办

支付服务商确定前只保留失败关闭，不新增伪造“支付成功”的路径。服务商、商户主体、中国/马来西亚币种与收单范围确定后，以单独变更集实施：

1. 服务端创建支付与退款请求，金额、币种和订单归属只从服务端订单读取。
2. 回调验签、时间窗、重放保护、幂等键、事件持久化和失败重试。
3. 支付、取消、全额/部分退款、超时、重复回调和金额不一致 E2E。
4. 每日对账、差异告警、手工补偿审批和客服可追溯记录。
5. Secret 只注入 API/Worker，更新 `.env.example` 时只写占位值；日志不记录完整卡号、密钥、签名或原始敏感回调。

## 每批必须通过的检查

```bash
bun install --frozen-lockfile --linker=hoisted
bun run lint:check
bun run build
bun run test
bun run --cwd packages/dev-server test:dev-workflow
bun run --cwd packages/storefront test
bun run --cwd packages/storefront build
bun run --cwd packages/dev-server build
bun run --cwd packages/dev-server build:production-runtime -- --require-platform linux/x64 --audit-level high
bun audit
```

涉及数据库、支付、邮件或部署时，还必须执行对应的生产环境预检、备份恢复演练和预发布 E2E。任何强制 override 如果不满足直接上游依赖的版本范围，必须先停止并改用协调升级。
