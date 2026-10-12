# 启动接管与账户域拆分验证

本目录记录本地合成数据验证，不能用于推断真实用户性能或生产业务结果。

## 已实现

- 客户端使用唯一正式路由和 QueryClient，预加载当前真实路由后一次 hydrateRoot；移除临时快照应用到正式应用的 root.render 替换。
- 服务端与客户端共享页面框架、路由层级、首帧数据、媒体上下文和组件边界；服务端每次渲染结束清理独立 QueryClient。
- 只有实际公共页面叶子提交后才标记 publicAdopted 并发送现有 page-ready 事件。首帧币种与快照一致，用户偏好在接管后更新。
- ShopApi 同步保留轻量身份读取；账户详情、地址、历史订单和账户动作按实际调用加载独立账户域，同上下文复用实例。原方法参数、取消信号、返回值和动作执行次数保留。

## 当前成功证据

| 检查 | 结果 | 证据边界 |
| --- | --- | --- |
| SSR / 页面就绪定向测试 | 64 通过 | 源码首帧与真实叶子提交语义 |
| 真正源码浏览器核心路线 | 28 通过 | dev-report-core-28.json |
| 真正源码浏览器边界路线 | 36 通过 | dev-edges-report.json |
| 账户适配与受影响原 API 用例 | 14 通过 | 最终适配器修复后，包括 8 个新增域测试和 6 个原调用时序测试 |
| TypeScript | 通过 | 最终适配器源码 |
| 账户相关 6 文件 ESLint | 通过，无告警 | 最终适配器源码；仅最后移除测试导入空行 |
| 最终正式产物核心 / 边界 | 28 / 36 通过，两个进程 exit 0 | navigation-final-core.log、navigation-final-edges.log、report.json、edges-report.json |
| 最终入口体积 | 376440 字节，367.617 KiB | index-BSTQ_0Vr.js；380 KiB 预算不变；相对原约 385 KiB 减少超过 17 KiB |
| 匿名公共页账户详情模块下载 | 0 | 最终 report.json、edges-report.json；实际重模块 account-DPzR22Kc.js 已单独检测 |
| 导航离开回归 | 53 项相关测试通过，最终新增 4 项再次通过 | 原商品卡和选中目录保留；有效搜索与解析后的分类继续读取 |
| 缓存导航 p95 | 390px：13.6ms；1440px：12.6ms | 各 40 个样本；最终 80 项新业务读取和代码下载均为 0 |

移动端所有验证均保留原页面框架、内容区、页面、首图和底部导航节点，未出现 hydration 恢复错误。桌面端保留原框架和内容区；原有响应式升级会替换分类页面组件并移除手机底部导航，不属于整树重建。

## 失败和修复记录

- dev-edges-failed-usdt-first.json：偏好币种提前污染尚未接管子树；以真实叶子提交事件延后偏好校准修复。
- dev-edges-failed-default-category.json：默认分类与服务端全商品缓存语义不同；使用正式分类解析和一致首帧状态修复。
- lazy-account-initial-failures.json：旧测试假设账户请求同步启动，导致延迟加载后响应分配顺序错误。等待请求实际启动后继续原时序断言，原 6 个用例复测通过；没有放宽业务断言。
- lazy-account-lint-failure.json：适配器原取消 Promise 的 lint 问题。改为等待取消信号后抛出原始取消原因，绑定真实实例调用；8 个新增测试及上述 6 个原用例复测通过。

最终构建按发布主任务统一安排执行并已成功；本任务在最后导航读取修复后复测最终产物的生产核心与边界路线，64 项全通过、无 hydration 恢复错误。移动端原页面、首图和导航节点保留，全部场景框架和内容区保留，公共页账户重模块下载为 0。初次拆分产物报告保存为 first-split-report.json、first-split-edges-report.json，避免与最终验证混用。上述证明只覆盖本地合成场景，不代表部署、线上浏览器验收或真实用户 p75 / p95 结果。

最后的缓存导航实验发现并修复了桌面分类旧页面在离开时误读首页参数的问题。最终 storefront 完整构建和 64 项接管验证已在这次真实运行时变更后重新完成；日志为 final-navigation-guard-build.log、navigation-final-core.log、navigation-final-edges.log。专项回归、计时方法和 80 个最终缓存导航样本见 warm-navigation-receipt.md。

最终导航 guard 源码为 packages/storefront/src/pages/desktop-catalog-page.tsx，SHA-256：6cec4676d1017a5547a36bef616570652c6a6dd322e32ac1bdf00cbc537abfd3。对应新回归 desktop-catalog-transition.spec.tsx，SHA-256：f61a4052d3be83ea7fde0da4bcdc243f9971e27f411df4376ce602f9191a73b2。最终入口 index-BSTQ_0Vr.js，SHA-256：c854811ea81bb6e61b2fb75bbbd5c9896de252e0503df05c6a73987f13b909f7。记录摘要后没有继续修改源码。
