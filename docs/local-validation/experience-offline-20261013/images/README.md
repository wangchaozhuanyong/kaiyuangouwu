# 图片与头像体验定向验证

状态：本代理代码完成、定向本地验证完成。未执行全构建、提交、推送、部署或生产数据操作。

## 改动

- SafeImage只把实际浏览器选择并成功解码的候选记为decoded。responsive小候选不再把original或大fallback别名标为ready；保留现有延迟响应、错误、取消和image语言context。
- CustomerAvatar的实际已解码候选可作同owner/同资源版本的视觉过渡；这不把当前更大候选标为ready。记录限制128项，清理decode缓存同步清理过渡；不同客户、不同版本不借用另一owner缓存。Root在CustomerAvatar传入retainedOwnerKey。
- SafeImageMediaProvider无DOM、无HTTP请求、无持久化或独立业务缓存，仅从当前page props/TanStack-owned media派生index。由hydrate/root在SSR与正式frame接入。
- 完整ASCII data URL单图≤1024bytes、页面hint metadata合计≤8192bytes；只接受PNG/JPEG/WebP base64。过大、外链、无效类型、错误资源版本、不同imageKind全部回退到native目标图片。只为显式high优先图使用内联hint，不竞争另一个远程placeholder。
- 内联小预览SSR即可显示；Root共用CSS使native最终图直接paint，不等待React挂is-loaded。

## 实际来源

只读检查`store-management-plugin/performance/storefront-public-media.ts`确认当前producer只生成媒体sources及尺寸，未传inlinePreview；因此当前真实来源inline hint为0bytes。已供hint能够接入，但不能声称现在所有首屏都有真实小预览。无hint仍走native原图/响应候选，不新建占位、不替换商户图片，也不增加占位请求。

## 检查结果

- `targeted-tests-after.log`：SafeImage/responsive 2文件44项通过，包含SSR native art direction、真实候选标记、晚响应/失败、资源版本、inline上限/总量、同版本头像复用、不同owner隔离。
- `typecheck-after.log`此前前台`tsc --noEmit`退出0；最终`typecheck-final.log`仅报告同期SSR代理新改`public-snapshot.tsx:126 detail={null}`类型不匹配，已通知该文件所有者修复。SafeImage相关无诊断；整体类型门禁需Root在此项修复后完成。`check:interaction`、`check:typography`（387源文件）通过；unification 1163源文件通过；相关diff whitespace通过。
- `lint-after.log`：本代理修改的源代码与images脚本0错误、0warning。Root统一处理旧visual脚本，本代理未覆盖这些处理。
- `avatar-app.json` / `avatar-app-after.log`：实际商城App，合成GraphQL数据，390/1440×经典/暗色共4组合；account→orders→referral→account-security→home→account客户端切页（可用真实Link，否则通过history事件驱动）。每rAF记录已展示avatar候选、完成状态、opacity/已解码过渡及几何；未出现透明且没有过渡的等待帧，account头像尺寸集合稳定（手机1规格、电脑40/48两种明确角色）。这不是逐像素录像，也不替代生产账户切页验收。
- `native-paint.json` / `native-paint-after.log`：实际SafeImage SSR markup +生产CSS，浏览器禁用hydration JavaScript。320/390/768/1024/1440×有/无hint共10状态通过；主图未挂is-loaded仍complete且opacity1、96×96，证明native paint不依赖React。截图`native-390-*.png`。

## 失败与修正

初次typecheck的测试客户缺phoneNumber，补真实类型要求null后通过。native harness初次拿到两份不同React依赖，改用storefront workspace同一React/renderer后通过；production SSR配置本身noExternal:true，不把harness依赖差异当生产源码错误。旧失败日志保留；未降低候选、版本、owner或预算断言。

`source-inputs.json`记录验收输入。所有截图、脚本与日志均在本项目此目录。本地服务验证后停止；总构建、SSR完整接管、生产指标和发布仍由Root统筹。
