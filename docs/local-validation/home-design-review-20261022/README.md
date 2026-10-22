# 首页设计与补充控制台问题审查

日期：2026-10-22（Asia/Kuala_Lumpur）。当前本地候选：代码、定向验证、商城完整构建及管理后台完整构建通过；用户已授权推送、合并及生产发布，远端CI与线上结果按实际回执另行补充。

## 归属与范围

- 项目：Vendure / 大马通 storefront。
- 隔离工作区：`/Users/wangchao/Desktop/源码文件夹/vendure开源/vendure-master/.codex-worktrees/home-design-review-20261022`。
- 分支：`codex/home-design-review-20261022`，基点 `6b661344274ca8b5417dc47db23c14abbd04d5af`。
- 保护原主目录及其他任务的未提交改动。未修改 Nginx、登录、权限、支付、业务活动规则或 CMS。

## 确认的问题与修复

| 问题 | 修复 | 证据 |
| --- | --- | --- |
| 1024px 桌面优惠券固定四列，单张约224px，挤压优惠名称和门槛 | 单张至少300px，额外券保留横滑 | 本地测量单张300px、券轨945px；方向键可以横移 |
| “全部优惠”点击区域仅24px高 | 使用已有控制尺寸变量，至少44px | 1024、390、360px均测得44px |
| 桌面首屏长标题、优惠名称出现不均衡换行 | 使用 `text-wrap: balance`；手机首屏保留既有 `pretty` 规则 | 1440px桌面与390px手机实页验收 |
| 性能上报一次 flush 并发发送多组，缺少429冷却，连续操作时可持续触发限流 | 每次只发送一组、至少间隔3秒；仅保留4组最近样本；429后丢弃旧队列、至少暂停60秒并尊重 Retry-After | 新增8项发送测试；包含慢请求、连续页面隐藏、秒数/日期/无效 Retry-After、隐私退出 |

性能上报是尽力采样。快速操作及冷却期允许丢弃样本；失败数据不重试，不影响购物或页面导航。多标签、同一公网IP的其他访客仍可能共同触发服务端限流，本次修复不能承诺线上永远不出现首次429。

## 补充截图中的其他提示

- **COOP / window.postMessage**：当前公开页面响应头为 `Cross-Origin-Opener-Policy: same-origin-allow-popups`，符合 [Google Identity Services 的弹窗配置说明](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#cross_origin_opener_policy)。警告来自Google客户端，不能单独证明登录失败或页面卡死。本次未执行新的实际Google登录，故端到端登录结果仍待验证，未降低安全头保护。
- **字体 slow network / fallback**：截图源指向Google登录按钮及 `fonts.gstatic.com`；站内现有字体使用系统字体栈。浏览器已启用降级字体显示，本次没有替换站内字体或修改Google托管资源。
- **SSE 连接重置**：此前公开页面实测连接重置后会重新建立200连接；单连接 ready/heartbeat smoke通过。尚未定位重置的服务端或代理根因，不能将其归因于设计CSS，也不能声称线上断连已消除。
- **个人中心设计**：补充截图的会员卡、订单、物流、工具区与底部导航均有清晰分区，未据静态截图发现需要立即重做的布局。真实订单及登录流程不属于已验证结果。

## 修改文件

1. `packages/storefront/src/styles/home-showcase.css`：券宽和入口点击区域。
2. `packages/storefront/src/styles/desktop-coupon-ticket.css`：优惠名称换行。
3. `packages/storefront-content-plugin/src/shared/hero-scene.css`：共享首屏标题换行，Admin共享渲染使用同一规则。
4. `packages/storefront/src/storefront-performance.ts`：限频、串行发送、有界队列、429冷却。
5. `packages/storefront/src/storefront-performance-delivery.spec.ts`：发送行为测试。
6. `packages/storefront/src/storefront-performance-observer.spec.ts`：更新真实Response夹具和串行发送时序断言，保留隐私边界断言。
7. `packages/storefront/src/main.tsx`、`packages/storefront/src/performance-entry.ts`：在原有load事件后加载初始化入口，减少主包回调代码。

## 本地验证

- 首页、轮播、HeroScene及皮肤的4个定向测试文件通过（258项）。排版审计测试首次与构建并行时超过其5秒默认时限；单独单worker复跑7/7通过，未放宽断言或时限。
- `vitest run src/storefront-performance.spec.ts src/storefront-performance-delivery.spec.ts src/storefront-experience-performance.spec.ts`：3文件、20/20通过。
- `check:interaction`：通过。
- `check:typography`：442个源文件、93个共享token通过。
- `verify:router-toolchain`：通过（1.168.33）。
- `tsc --noEmit`：通过，随后客户端Vite编译成功。
- `git diff --check`：通过。
- `check-storefront-unification.mjs`：1255个共享运行时文件检查通过。
- 本地Chrome：1024px中文经典皮肤、390px中文经典皮肤、360px英文neo皮肤、1440px桌面首屏。页面无横向溢出；券轨方向键横移正常；可见领取按钮点击后本地计数增加；长文案能滚动到底，CTA点击后计数增加；长短轮播切换手机画框均为293px。
- Public server build：成功，见 `public-server-build.log`。
- Two-factor build：成功，见 `two-factor-build.log`。本次仅编译，未修改其逻辑。

### 发布前验证补充

- 按锁文件在本工作区独立安装依赖，使用CI相同hoisted布局；未修改依赖声明、锁文件或主目录依赖。商城Vite恢复为7.3.7。
- CI同等相关测试首次运行：112个文件、1995项通过；性能观察测试仍假设两组并发，需要随新行为更新；图片工具一个5秒超时导致后续3项连带失败。修复断言和lint后，以 `VITEST_MAX_WORKERS=2` 复核失败文件及直接依赖，5文件56/56通过；未放宽断言、延长时限或关闭检查。见 `failed-check-repair.log`。
- 管理后台：222个文件1782/1782测试通过，反馈/交互门禁、类型检查、Vite编译和生产挂载校验通过，见 `admin-locked-validation.log`。
- 最终增量lint通过，见 `scoped-lint-final.log`。
- 最终商城 `bun run build` 完整通过，含客户端预算、public server及2FA产物；见 `storefront-final-build.log`。
- 懒加载入口涉及的main、public bootstrap、brand bootstrap及传输测试：4文件34/34通过，见 `lazy-entry-validation.log`。

### 体积门禁的失败与修复

原候选的 `bun run build` 生产资源预算检查失败：分类页初始JS **955429 B**，预算为 **955392 B**（933KiB），超出37 B。

对照构建保留相同设计CSS，仅在Vite内存加载阶段将性能上报模块替换为HEAD原文，未回退工作区的有效修复。对照分类页为 **955425 B**，也超预算33 B。快照为 `performance-before.ts.txt`，构建日志为 `baseline-build.log`，本地生成文件位于被本目录忽略的 `baseline-dist/`。这证明上报改动不是预算越界的唯一原因；不能据此声称完整HEAD已通过或完成全量发布验收。未改预算、依赖或构建配置。

最终将性能采集初始化放入独立的懒加载入口，保持原有load时机和隐私判断。分类页初始JS为 **955380 B**，低于预算12 B；启动JS为730259 B。所有现有客户端资源预算通过，没有修改预算或构建配置。

## 截图

- [1024px优惠券](coupon-desktop-1024.png)
- [390px优惠券](coupon-mobile-390.png)
- [360px英文neo优惠券](coupon-mobile-en-neo-360.png)
- [1440px首屏长标题](hero-desktop-long-1440.png)
- [390px首屏长文案滚动和操作后](hero-mobile-long-390.png)

截图均为项目既有真实组件、本地合成内容，不是线上发布效果证明。
