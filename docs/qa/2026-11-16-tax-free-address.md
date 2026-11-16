# 免税地址工具

模钥商城「商业服务」的客户端插件 `tax-free-address-entry` 打开 [独立地址工具](https://address.moyaoai.com/)。上线配置仅在模钥店铺安装并启用。共用组件按各店已发布配置渲染。

同标签页从商城插件进入时显示「返回上一页」，只调用浏览器历史；工具不接收或保存商城链接。直接打开或复制链接到新标签页时只有地址工具，无商城导航、登录、品牌或商城资源。

- 无需登录，服务端按独立域名浏览器身份限制每 5 分钟一次。本机最多保留最近 1000 条，支持查看、清空和一键复制；复制保留中文字段名、英文值和邮编前导零。
- 成功领取即标为已使用。库存为空时在同一事务补充 100 条，完整明细最多保留 1000 条，优先清理最早使用的明细。永久街道指纹与领取回执单独保留。丢失响应时核对原请求，已经清理的明细不会分配新地址。
- 地址沿用参考项目「比特登录 → 地址管理」的数据范围；89,000 个街道组合耗尽后停止生成。这些是地址模板，未验证可投递性。
- 「插件 → 免税地址管理」要求 SuperAdmin；支持筛选、搜索、分页、手动生成、提取并复制、版本核对后的清理。清理不删除永久指纹。

`packages/store-management-plugin/src/tax-free-address/` 提供后台 GraphQL 和独立域名的 `GET /api/address/status`、`POST /api/address/claim`。读取状态不消耗库存；发放需签名的 Secure/HttpOnly host-only Cookie 及同源请求。商城 Shop GraphQL 不注册提取字段。

`packages/storefront/tax-free-address-tool/` 单独打包在商城制品 `dist/.address-tool`，不编译商城壳层；`deploy/nginx/damatong.conf` 仅在精确域名上提供独立页面、静态资源与两条地址接口，不暴露后台、商城路由或登录状态。迁移 `1794787200000-add-tax-free-address.ts` 只新增三张表；原数据无需改写，回滚代码须保留永久记录。

上线先签发该独立域名证书（`/etc/letsencrypt/live/address.moyaoai.com/`），正式发布并核对独立虚拟主机后再发布 DNS 和模钥入口。正式验收只读状态与页面，不发放真实地址。

本地验证：运行新增服务、后台权限、客户端和后台组件测试及两个前端构建。`node --test deploy/nginx/storefront-fallback.spec.mjs` 在隔离 Nginx 容器验证虚拟主机；`packages/storefront/e2e/tax-free-address/verify.mjs` 用已编译页面和合成回执验证手机、桌面、新标签页直达、同标签页返回及后台管理。真实生成、并发领取和清理只在本地测试库执行。
