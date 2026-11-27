# 马来西亚入境卡插件

## 交付范围

- 客户端采用本站 React / TypeScript 页面壳、字体、控件、主题和响应式布局，路由 `/mdac`，无需客户登录。
- 三步流程：护照识别或手填 → 联系与行程 → 逐人核对。支持最多 20 位旅客共用联系与行程信息。
- 自动识别姓名、护照号码、国籍、生日、性别、有效期，并识别资料区的出生地点、匹配出生国家／地区。机读码校验不通过时保留原输入并允许手填；出生地未可靠识别时仍保留其余六项结果，提示补充或核对。所有识别结果，尤其是出生年份和出生地，必须复核。
- 新表单默认中国 +86、飞机、中国出发和酒店。按马来西亚当地落地日期填抵达日，建议离境日为抵达日加 29 个日历日。手填离境日期在改抵达日时保留。航班号按实际抵马航段填写。乘飞机的旅客须查找并选中与当地抵达日期、抵达机场和票面航班号一致的可用班次，才能进入核对资料。更改其中任一项或重新打开草稿后都须重新核验。旅客核对实际离境日期与住宿后方可导出。
- 旅客可搜索实际预订的酒店，一键带入地址、州属、英文城市和邮编，也可手填住宿。静态目录在输入至少两个字符时才从同源读取。酒店搜索词、旅客资料和地址都在浏览器内处理。
- 导出与 nilbloom/mdac 兼容的 JSON，在安装了用户脚本扩展的浏览器中导入、选人、填表，用户在官网完成验证并提交。本站不自动提交、不产生官方回执、不模拟提交成功。
- 普通不支持扩展的手机浏览器可以识别、保存、核对资料，需要对照官网填写；这不是手机端跨站一键代填方案。

## 数据存储约束

首次进入默认开启本机草稿。旅客编辑后将字段写入同一浏览器、同一站点的 `localStorage`，仍使用 `storefront-mdac:v1`，可恢复旧版草稿。关闭保存会用不含旅客资料的 `off` 替换该草稿并记住选择，当页仍可继续填写。“清除本机资料”同时清空当页输入并停止保存；其他工具的存储不受影响。

护照照片不写入 localStorage，识别时不调用商城上传或业务 API。OCR 在浏览器 Worker 内执行，结束/取消时释放图像画布和 Worker。识别资源由同源 `/mdac-ocr/` 提供，仅识别时加载；无运行时 CDN。航班查询独立使用抵达日期、机场和票面航班号，不接收旅客及联系人信息。没有云端 OCR、旅客表、数据库迁移或订单/支付/账号核心修改。

本机草稿不是加密保险库，不适合共用设备；清除浏览器站点数据会删除草稿。另一个标签页修改/删除草稿后，当前页保留输入但停止自动覆盖保存。存储被禁用或空间不足时明确提示。

下载的 JSON 和导入用户脚本后的 Tampermonkey 本机存储是独立副本；本站的清除按钮不能删除它们。脚本扩展不要启用云同步。官方最终提交会将资料交给马来西亚移民局，不属于“资料从不离开设备”的承诺。

后台只保存插件的启用、位置、排序、中英文文案等配置。后台没有旅客查询、名单、统计或导出接口。

## 仅 damatong.net 开放

生产 PM2 配置默认将 `STOREFRONT_MDAC_ALLOWED_DOMAIN` 设为 `damatong.net`，仍须存在该域名的 ACTIVE 店铺绑定，当前 Channel 才可启用 `mdac-entry`。其他运行环境可参考 `deploy/mdac.env.example`。配置为空、域名未激活或不属于当前 Channel 时，服务端拒绝启用，但仍可停用或移除。

策略通过现有 StoreDomain 元数据查询，无新增数据库实体。Admin 使用具有原内容读取权限的新查询 `availableStorefrontClientPluginCodes` 获取可用插件；保存仍沿用原内容版本、草稿保护和内容写入权限。

公开内容读取再次过滤未授权条目，并由服务端设置 `allowedHost`。客户入口和直接访问 `/mdac` 都核验发布配置及当前主机。域名只用于开放权限，不用于选择视觉组件或品牌默认文案。

本地预览绕过生产路由的方式是独立 e2e 夹具直接渲染实际组件；生产路由没有 localhost 白名单。夹具数据是虚构数据，后台夹具阻止真实写入。

发布预检如需指定渠道，用 damatong.net 的 Shop API 查询 `activeChannel.code`，当前值为 `美宜佳`。店铺 token 与渠道编码分别使用。

运行时发布完成后，在 damatong.net 对应店铺的「客户端插件中心」添加「马来西亚入境卡」，选择商业服务页主区，启用并保存。发布前后核对已有插件和图片绑定。

## 主要接入位置

| 位置 | 修改用途 |
| --- | --- |
| `packages/storefront/src/client-plugins/mdac/` | 独立客户页、字段映射、本地草稿、识别适配器及测试 |
| `packages/storefront/src/routes/mdac.tsx`、`route-pages/mdac-route-page.tsx` | 既有路由加载、首载/失败状态与开放范围 |
| `storefront-router.ts`、`storefront-access.ts`、`desktop-page-contract.ts`、`route-component-preload-private.ts`、`client-plugin-registry.tsx` | 路由、访客权限、页面分类、懒加载与插件入口注册 |
| `packages/storefront-content-plugin/src/client-plugin-manifest.ts` | 中英文插件目录 |
| 同包 `storefront-content.service.ts`、`storefront-content.resolver.ts`、`api-extensions.ts` | 开放策略校验和 Admin 可用目录查询 |
| `packages/next-admin/src/pages/Plugins/ClientPluginsModule.tsx` | 复用现有后台设计，增加受限目录、启用开关和数据说明 |
| `packages/storefront/scripts/prepare-mdac-ocr.mjs`、`package.json`、`bun.lock` | 固定依赖、自托管识别资源准备 |
| `packages/storefront/vite/storefront-manual-chunks.ts` | 识别库独立命名懒加载，避免被首页 index 资源统计误纳入；未提高性能门槛 |
| `packages/storefront/public/mdac/` | 浏览器用户脚本及 MIT 许可证 |

## 本地运行

安装依赖：仓库根目录执行 `bun install --frozen-lockfile`。

客户组件：在 `packages/storefront` 执行 `bun run dev --port 5178`，打开 `http://127.0.0.1:5178/e2e/mdac/index.html`。`?lang=en&skin=neo-minimalist` 可查看英文及另一主题。

追加 `flight=demo` 可用虚构班次体验航班查找。机场填 `KUL`，共享编号用 `CX777`，取消用 `MH999`，无匹配用 `XX999`，不可用用 `XX998`。

已开放并发布的 MDAC 入口从 Vendure 服务端读取航班核验能力。令 `STOREFRONT_MDAC_FLIGHT_LOOKUP_ENABLED=true`，并通过受管服务端环境设置 `STOREFRONT_MDAC_FLIGHTBYTE_API_KEY`，可使用 FlightByte。未配置 FlightByte 时可使用允许对客显示的 OAG Flight Info v2 套餐，密钥名为 `STOREFRONT_MDAC_OAG_SUBSCRIPTION_KEY`。密钥仅供服务端使用。

FlightByte 每月提供 120 次免费查询。接口按起飞地当地日期定位航班，服务端核对旅客填写的票面航班号、机场和马来西亚当地抵达日期，并在需要时检查前一日出发的班次。近期班次可核验。较远日期、配额耗尽或数据源暂不可用时，旅客可保留草稿后重试，也可自行前往移民局官网登记。缺少匹配记录时请旅客对照机票核对。

开关默认关闭。航空行程必须选中已核验的符合条件班次才可进入核对页，其他入境方式沿用原流程。官方入境卡提交继续使用移民局的登记页。

后台组件：在 `packages/next-admin` 执行 `bun run dev --host 127.0.0.1 --port 5180`，打开 `http://127.0.0.1:5180/e2e/admin-layout/index.html?view=plugins&mdac&light`。去掉 `mdac` 参数模拟未开放店铺。

这些入口仅用于本地实际组件验收，Vite 生产构建不发布 e2e 页面。

## 开源来源与改动边界

- [nilbloom/mdac](https://github.com/nilbloom/mdac)，MIT，下载基线 `5c96a14`。未改下载的原仓库。发行副本做适配加固：导入姓名使用文本节点、清表使用正确 textarea setter、城市名称匹配后写入实际选项编码、匹配范围限登记页、禁用未经复核的上游自动更新；保留主要填表流程。
- [itsmeminsithu/Passport-MRZ-Reader](https://github.com/itsmeminsithu/Passport-MRZ-Reader)，MIT，基线 `bb667f0`。`mrz-parser.js` 原样保留；本插件在适配器处理未来生日年份、完整校验和本地生命周期。
- [Tesseract.js](https://github.com/naptha/tesseract.js)，固定 `6.0.1`，Apache-2.0；核心版本由 bun.lock 固定。模型采用 [Shreeshrii/tessdata_ocrb](https://github.com/Shreeshrii/tessdata_ocrb) 的 OCR-B fast 版本，Apache-2.0，固定提交 `0daabbebc043922effa111711a5804467bf961d4`。模型、许可证及 SHA-256 清单保存在 `packages/storefront/vendor/mdac-ocr/`；构建先校验再复制同源资源，不在用户识别时访问 GitHub。浏览器先去除黑边、裁切机读码区域、放大并增强对比度，再自动校正倾斜；最多尝试三个区域，全部保留原解析器的五项校验。
- 出生地使用 [tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) 的英文模型，Apache-2.0，固定提交 `87416418657359cb625c412a48b6e1d6d41c29bd`，存放在 `packages/storefront/vendor/mdac-birth-ocr/` 并校验 SHA-256。只读取出生字段标签下的值；匹配官方国家名称/代码及明确的中国省级名称，不根据国籍推断。低置信度、未知地名或冲突标签不自动填写。小字标签仅部分可读时，仅在中国签发证件且匹配“出生地在上、签发地在下”的同列标签结构时启用有限容错；不能确认结构时留待人工。中国护照、国外出生与港澳台选项单独测试。
- 字段选项/长度来自 2026-11-16 读取的[官方登记页](https://imigresen-online.imi.gov.my/mdac/register)，不是资料接口或稳定 API。官方字段变化后需重新验收。
- 酒店资料从 OpenStreetMap 及 Overture Places 提取，与 MOTAC 的吉隆坡和雪兰莪登记名录交叉核对，州属、城市和邮编匹配 MDAC 的公开选项。2026-11-17 目录实收 475 家，吉隆坡 215 家，雪兰莪 260 家。来源和再发布许可见随目录发布的 `hotel-directory-sources.txt`。

## 验证记录与限制

已验收：实际组件完成手填三步、刷新恢复勾选保存的草稿、清除、浏览器存储失败/多标签冲突、识别取消后不恢复迟到结果；后台取消启用后刷新保留未保存草稿。390 CSS 像素手机宽度测量无水平溢出，中文/英文和两主题已检查，未测试真实手机拍摄硬件。

公开 ICAO 虚构样本实际浏览器识别得到 `ERIKSSON ANNA MARIA`、`L898902C3`、`1974-08-12`、`2012-04-15`，校验通过；样本为过期虚构证件，不能用于真实提交。失败时不覆盖已有输入。此结果不代表真实护照拍照的准确率。

单元测试覆盖旅客字段、日期、导出映射、本机存储、取消、脚本文本安全、访客入口、域名/Channel 隔离、域名失效后的公开内容过滤以及后台既有配置与草稿机制。使用各受影响包的标准检查/构建；未运行全仓 CI/数据库矩阵。

生产 Nginx 仅向同源 OCR Worker 的响应授予 WebAssembly 执行权限，并允许获取两份随构建发布的 OCR 模型。浏览器已在这套 Worker 策略下识别虚构护照和出生地，并确认模型请求都指向本机测试站。

2026-11-16 官网表单兼容性验收使用当日官方页面 HTML 和公开的只读联动查询。浏览器导入虚构旅客资料后核对姓名、护照、出生地、邮箱确认、行程及住宿等字段，并验证城市查询结果与隐藏字段一致。实际官方提交和回执需要使用真实旅客的合规申请验证。
