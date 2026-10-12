# 视觉、间距、固定底栏与二维码本地验证

状态：代码完成、本地组件验证完成。没有执行提交、推送、部署或生产数据操作；总构建由主代理统一执行。

## 已完成

- 森林邀请 #173d39、象牙奖励/记录 #f4f1e9；暗色奖励/记录 #243b36 + #e9f0eb。活动角色在共享 storefrontSkinCssVariables 中生成，首帧 CSS 与运行时输出有一致性测试；商家内容/图片/海报未替换。
- 普通模块手机16px/电脑24px，主章节24px/32px。首页父容器拥有一次间距，轮播数字在手机图片内右下各12px，每个44px触控，复用现有轮播索引。
- AI页面取消重复预留；共享测量器只计算实际可见fixed栏高度。页面末尾加16px；最低一层安全区只算一次；历史页没有虚假生成栏空间。trackFixedBottomBars由主代理持有，本代理通过实际DOM几何和已有测试验证。
- 客服二维码使用原图预览与原生长按；提前准备File，用户手势直接调用系统分享，取消不转下载，不支持分享保留预览，文件失败可重试。桌面下载原文件，反馈只说明已启动下载/系统分享流程结束。
- 修复DOMException取消判断跨realm问题与DOM lib对share/canShare类型常量检查问题，增加缺失能力测试。

## 定向检查

- `targeted-tests-after.log`：9测试文件、155项通过（皮肤、轮播、首页间距、底栏布局/测量/视口、交互与文字门禁）。
- `palette-tests.log`：共享语义配色21项通过，含活动全文/辅助文字/各交互态对比度≥4.5。
- `referral-support-tests.log`：返利/客服22项通过。
- `typography-tests.log`：文字门禁测试7项通过。
- `final-affected-tests.log`：最终受影响皮肤/返利/二维码61项通过；`qr-final-tests.log`：能力检测补正后二维码8项通过。
- `check:interaction`、`check:typography`（385源文件）、共享店铺unification（1157源文件）通过；相关文件`git diff --check`通过。
- `bunx tsc --noEmit`退出0，日志`typecheck.log`无诊断。主代理后续修改公共启动框架时应按新输入继续总构建。

## 实际组件浏览器矩阵

`browser-matrix.json`记录160状态：320/390/768/1024/1440 × 经典/暗色 × 中/英 × 两个合成店铺 × 首页/返利/AI/客服。使用当前生产React组件，周围仅本地fixture，全部业务API由合成内存数据替代，不连接生产。浏览器Chromium。

结果：160状态、0错误。检查横向溢出；共享16/24间距；分页44px和右下12px；手动切换索引；森林/象牙/暗色活动角色与16/24卡片内边距；实际底栏height+16；模拟安全区34px时生成栏110px、正文预留126px、最后正文到操作栏16px±1；模拟键盘300px时文档预留不增；历史页预留16px且测量clearance0；二维码原图、弹层焦点/滚动锁、取消系统分享、桌面下载入口、关闭后释放滚动锁和恢复触发按钮焦点。

原始失败保留在`browser-matrix-before.json`：间距探针错误选到fixed操作栏自身。修正为条款所属正文section后仅复查24个受影响手机AI状态；另一个焦点瞬时断言改为等待指定原触发按钮获得焦点后复查。`browser-matrix-recovered.log`记录25项复查、0错误，没有放宽间距或焦点要求。

`accepted-*.png`保留代表截图，其中`*-studio-bottom.png`展示滚到底部后的正确间距。`fixture.tsx`/`fixture.html`、`serve.mjs`、`verify.mjs`/`verify-recovered.mjs`为可复现本地验证脚本。`source-inputs.json`保存受影响输入指纹。

## 证据边界

本地组件矩阵不替代整个应用启动/SSR接管、已认证会话与缓存导航、生产实测或真机系统相册写入。安全区/键盘与Web Share由浏览器能力及几何模拟；原生iOS/Android分享目的地和长按菜单需要真机，不声称图片已实际写入相册。前后台总构建、发布和生产验收由主代理统一完成。

## 320px金额专项补验

Root截图复核发现原PriceDisplay分段节点在返利局部flex-wrap与overflow-wrap:anywhere规则中拆断了MYR与29.9。只调整返利金额所有者：复用formatMoney输出，把货币标签与完整数字分组，数值单个nowrap文本；普通金额保留promotion/metric，较长数值使用既有price角色并让summary单列；极端数值局部横滑，不省略、不缩写。通用PriceDisplay未改。

`amount-tests.log`：返利与皮肤57测试通过；`amount-lint.log`及`amount-script-lint.log`0错误/0warning；typography 387源文件通过。`amount-matrix.json`：320px×中/英文×经典/暗色×普通/大额8状态、0错误。普通12500/2990分显示125/29.9；大额123456789/999999999999分显示1,234,567.89/9,999,999,999.99；所有数值文本Range只有1行，当前测试金额全部无需横滑、无页面溢出。`amount-320-*.png`是对应8张实际组件截图。未重跑之前160状态矩阵。
