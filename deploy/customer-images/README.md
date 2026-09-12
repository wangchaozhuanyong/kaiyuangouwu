# 客户图片与 2FA 安全改造

当前交付是本地代码、测试和配置模板。没有创建云资源、修改生产配置、迁移客户数据或部署。不要直接把示例中的域名、目录和运行用户用于生产。

## 数据流与存储位置

| 内容 | 新写入位置 | 读取方式 |
| --- | --- | --- |
| 原始上传内容 | 独立图片进程的私有、限容 tmpfs 隔离区，完成或失败后清理 | 没有 HTTP 文件入口 |
| 头像 | 本地 `CUSTOMER_AVATAR_STORAGE_ROOT/avatars/v2/`；启用 S3 后进入专用头像桶的 `avatars/v2/` | 本地 AssetServer；S3 模式通过独立 CloudFront 域名公开读取 |
| 参考图、生成图 | 本地原有 `IMAGE_GENERATION_STORAGE_ROOT`；S3 模式进入另一私有桶的 `private/v1/` | 应用检查客户和 Channel，签发最长 5 分钟的下载链接 |
| 管理端普通素材 | 保留原 AssetServer 存储策略 | 保留原接口 |
| 2FA 临时账号 | 浏览器内存 | 离页、退出或闲置 5 分钟清空 |
| 2FA 加密账号 | 2FA 页面所在 origin 的 localStorage，仅密文 | 用户独立口令解锁；不上传服务器 |

参考图按现有图像生成业务发送给所选图像服务；私有存储并不取消这项必要的数据传输。不要把参考图接入头像的公开 CDN。头像是公开内容，替换后旧 CDN 缓存可能继续存在最多约 5 分钟；无法撤回他人已经保存的副本。私有图片删除会立即撤销应用下载权限；存储删除失败留下待清理记录，定时任务重试。版本化 S3 的旧版本按模板保留 7 天用于恢复，这不是“物理立即擦除”。

## 图片处理进程

`../image-worker/server.cjs` 只接受 Unix socket 上的三种请求，不监听 TCP。先扫描原始字节，再使用独立子进程完整解码、去除元数据、重新编码。仅接收 JPEG、PNG、WebP，拒绝 SVG、动画、多页、损坏内容和超限输入。

| 类型 | 输入容量 | 像素限制 | 输出 |
| --- | --- | --- | --- |
| 头像 | 5 MiB | 1600 万 | 不超过 512 × 512 的 WebP |
| 参考图 | 10 MiB | 4000 万 | 重新编码的 JPEG/PNG/WebP |
| 生成图 | 25 MiB | 4000 万 | 重新编码的 JPEG/PNG/WebP，并保留分辨率档位验证 |

应用每进程最多 4 个在途处理请求；worker 最多 2 个活动请求，繁忙时拒绝而不无限排队。解码子进程最长 15 秒，应用请求最长 30 秒。生产缺少 socket、扫描服务故障、扫描超限、命中检测、病毒库超过 48 小时，均拒绝写入。开发模式未配置 socket 时使用进程内解码，**不代表已扫描或已隔离**。

安装前核对 `vendure-image-worker.service.example` 与 `clamd.conf.example`：

1. 为图片进程建立独立 UID。业务服务只需进入能连接 processor socket 的组；worker 只需访问 ClamAV socket，不读取业务 `.env`，不持有数据库或 AWS 凭据。
2. 将示例中的业务秘密目录、数据目录和代码路径替换为目标机实际路径。解码进程需要只读代码、Node 和 native image libraries；不能授予业务数据的写权限。
3. 确认 systemd 的地址族、文件系统、进程可见性和 cgroup 限制在目标 Linux 上生效。示例给 worker 768 MiB 内存、150% CPU、128 MiB 隔离 tmpfs；ClamAV 另行配置服务资源上限。
4. 使用 `freshclam.conf.example` 和 `vendure-image-signature-update.service.example` / `.timer.example` 准备独立更新服务，每 6 小时更新并随机延迟最多 30 分钟。核对 `DatabaseDirectory`、`NotifyClamd` 和目标路径；避免与系统已有 updater 重复运行。模板尚未安装，仍需监控定义年龄和更新失败，并在目标机完成真实 clamd 与 worker 验收后启用应用配置。
5. 验证正常小图成功、无害杀毒测试标记被拒绝、杀毒停止/过期时上传失败、失败隔离文件被清理。日志只留状态、统计和请求标识，不记录内容、签名 URL、密钥或原始文件名。

解码和杀毒分别降低不同风险，不能保证检测未知恶意内容。tmpfs 限容、低权限运行及及时更新仍是必要条件。进程崩溃造成的隔离残留随私有 tmpfs 生命周期清理；持续清理失败应告警，不能无限扩容。

## S3 与 CDN 配置

`storage.template.json` 准备两个桶、头像 CloudFront OAC、响应头策略和未挂载的应用 IAM policy：桶默认不公开，阻止公开 ACL/策略，启用 SSE-S3 和版本保留，禁止非 HTTPS 访问；只有 CloudFront 能公开读取头像前缀。应用写入使用随机键、条件写和 SHA-256 校验，不自动建桶。

模板通过 JSON、针对性策略断言和 cfn-lint 1.56.1 的本地资源 schema 校验；尚未通过 AWS 服务端校验，也未验证目标账户 IAM、区域、配额、计费或 DNS。模板保留资源删除/替换保护，但生命周期本身会在 7 天后删除非当前版本；启用前必须确认保留期与备份要求。版本保留不替代独立备份。

应用变量见 `packages/dev-server/.env.example`：

- `CUSTOMER_IMAGE_PROCESSOR_SOCKET`：生产必需的绝对 Unix socket 路径。
- `CUSTOMER_AVATAR_STORAGE_ROOT`：独立绝对持久目录；不能与普通素材或私有图片目录嵌套。
- `CUSTOMER_IMAGE_STORAGE`：`local` 或 `s3`。
- `AWS_REGION`、`CUSTOMER_AVATAR_S3_BUCKET`、`CUSTOMER_PRIVATE_IMAGE_S3_BUCKET`、`CUSTOMER_AVATAR_CDN_ORIGIN`：S3 模式全部必需，两个桶必须不同，CDN 配置必须是无路径的 HTTPS origin。

桶权限只授予已核对的业务运行角色。无需新增静态访问密钥。头像 CDN 域名应与商城分离，且不接收商城 Cookie；同时核对商城实际 CSP `img-src` 是否允许该媒体域名。旧头像标识仍走原存储策略；旧私有图片仍按数据库中的原路径读取。

**不要在已有 `avatars/v2/` 数据后直接切换 local/S3 模式。** 新命名空间不自动在两个后端之间回退；切换前必须先按下述流程复制、校验并确认所有现用键可读。S3 模式自动扫描远端孤儿对象；历史本地孤儿的盘点与清理需要单独安排，不能误报已自动完成。

## 独立 2FA 页面

`packages/storefront` 构建会额外生成 `dist-two-factor`；生产运行包包含此目录和图片 worker 三个脚本。独立页面没有商城 API、分析脚本或外部请求；消息只传客户 ID、语言及页面就绪/返回状态，精确检查 parent origin 与 window source。

1. 选择独立 HTTPS origin，建议独立可注册域名。一个 vault 实例只绑定同一商城后端的用户 ID 空间，不能合用到用户 ID 可能冲突的独立项目。
2. 构建时设置 `VITE_TWO_FACTOR_ORIGIN=https://vault.example.net` 和 `VITE_TWO_FACTOR_PARENT_ORIGINS=https://shop.example.com`，多个父 origin 用逗号分隔，不带尾斜线或通配符。它们属于构建配置，修改服务器运行时环境不会改变既有 JS。
3. 用 `vault-nginx.conf.example` 部署静态独立站点，替换证书和精确 `frame-ancestors`。在商城 Nginx 的 `/etc/nginx/customer-vault-frames/` 安装经核对的 map，匹配 `vault-parent-origins.map.example`。验证实际响应头和 iframe 加载，不能只确认文件已复制。
4. 独立页面 CSP 拒绝网络请求及表单外发。iframe 必须保留 `allow-forms`，使正常 JS 表单提交事件可运行；CSP `form-action 'none'` 阻止真实外发。禁止扩大 parent allowlist 或启用同源商城脚本注入。

未配置独立 origin 时，工具在当前商城 origin 使用临时/加密模式，**不具备跨域隔离**。配置错误时显示错误，不默默降级。浏览器禁用第三方存储、缺少 Web Locks/WebCrypto 时仍可临时使用，并保留旧数据。本地 Chromium、Firefox、WebKit 均通过加密备份下载/恢复及存储被禁用时的临时模式检查；生产域名和真实移动设备仍需验收。

加密使用 PBKDF2-SHA256 600000 次、随机 salt 和 AES-256-GCM，绑定客户 ID；每次写入随机 IV。口令至少 12 个字符，密钥仅存在解锁内存中。并发写使用 Web Locks 与版本比较。加密不会防御独立页面自身在解锁期间的 XSS，也无法撤销已复制到剪贴板的密钥。

旧明文数据必须由用户设置口令迁移，完整写入、读回和解密比对成功后才移除旧存储项；清理失败时提供重试。不同 origin 的旧数据通过用户下载/导入加密备份迁移，不通过 postMessage 传密钥。先关闭旧版工具标签，避免旧客户端再次写入明文。忘记口令无法恢复，备份也需要原口令和同一商城账号。

批量导入只解析本地文本，不执行内容：65536 字符上限、200 行、每行 1024 字符、最多 100 账号，校验 Base32 和重复记录。加密备份最多 256 KiB；不接受任意文件作为可执行内容。

## 旧图片迁移与回退

本轮只提供 `migration-plan.cjs` 的本地准备模式，不执行 S3 写入、数据库更新或原文件删除。每批最多 200 条，inventory 最多 512 KiB。

```json
{"version":1,"assets":[{"id":"synthetic-id","kind":"reference","storageKey":"reference/example.png","sha256":"<sha256>"}]}
```

类型为 `avatar-source`、`avatar-preview`、`reference`、`output`；只记录内部 ID、键和校验值，不在 inventory 中保存客户内容或签名链接。

```sh
node deploy/customer-images/migration-plan.cjs inventory.json /reviewed/avatar-source-root /reviewed/private-source-root /reviewed/new-staging-dir
```

脚本要求新暂存目录，严格限制输入目录、文件大小和格式，使用有界读取，重新处理图片，写入权限为 0600 的新文件与 `plan.json`。计划包含处理后的宽高、类型、大小和 SHA-256，避免方向纠正后仍使用旧尺寸。原文件不覆盖、不删除。开发回退生成的计划 `isolatedProcessor=false`，不能作为生产处理验收。

旧头像在新头像提交成功后清理；只有源图和预览均删除成功，才移除旧数据库记录。存储故障时保留记录和配额，后续替换会再次尝试；达到配额前持续清理失败需要运维处理，不能绕过配额放任残留增加。重复删除已经清理的本地文件视为成功。

后续获准迁移时，应先备份，再把合格新文件复制到目标键，读回核对 SHA-256/容量/类型，最后条件更新数据库旧键及关联 metadata。头像 source/preview、私有图片 mime/尺寸/byteSize/sha256 必须一起匹配；不能只改 URL。保留旧键、原文件、映射清单和回退窗口。真实迁移、数据库切换和原文件清理仍未执行；不可恢复删除需要单独确认。

## 验证参考

文件隔离和重新编码参考 [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)。浏览器存储仍受同源脚本威胁，参见 [OWASP HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)。杀毒协议使用 [ClamAV clamd INSTREAM](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)，操作系统限制需按目标机的 [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) 验证。
