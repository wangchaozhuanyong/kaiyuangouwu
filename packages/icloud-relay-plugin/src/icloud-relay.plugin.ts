import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';
import { IcloudAdminResolver } from './api/icloud-admin.resolver';
import { IcloudPortalController } from './api/icloud-portal.controller';
import { IcloudPublicResolver } from './api/icloud-public.resolver';
import { IcloudPrimaryAccount } from './entities/icloud-primary-account.entity';
import { IcloudQueryAuditLog } from './entities/icloud-query-audit-log.entity';
import { IcloudReceivedMail } from './entities/icloud-received-mail.entity';
import { IcloudVirtualEmail } from './entities/icloud-virtual-email.entity';
import { IcloudJobService } from './jobs/icloud-job.service';
import { IcloudAccessCodeService } from './services/icloud-access-code.service';
import { IcloudAdminService } from './services/icloud-admin.service';
import { IcloudCipherService } from './services/icloud-cipher.service';
import { IcloudImapSyncService } from './services/icloud-imap-sync.service';
import { IcloudMailSanitizerService } from './services/icloud-mail-sanitizer.service';
import { IcloudOtpExtractorService } from './services/icloud-otp-extractor.service';
import { IcloudPublicQueryService } from './services/icloud-public-query.service';
import { IcloudRelayPluginOptions } from './types';

/**
 * @description
 * iCloud 隐藏邮箱智能分发与客户查询插件
 *
 * 核心功能：
 * 1. 管理后台录入 iCloud 主邮箱（Apple ID + App 专用密码）
 * 2. 绑定虚拟邮箱（Hide My Email 地址）到主邮箱
 * 3. 自动通过 IMAP 同步主邮箱收件箱，智能解析邮件头多级匹配分发到虚拟邮箱
 * 4. 为每个虚拟邮箱/主邮箱生成独立查询码，支持自动轮转/手动重置
 * 5. 客户通过公开查询接口凭查询码查看对应邮件（含智能验证码高亮提取）
 * 6. 访问 /mail-query 即可进入买家查件端 H5 页面
 *
 * @example
 * ```ts
 * import { IcloudRelayPlugin } from '@vendure/icloud-relay-plugin';
 *
 * export const config: VendureConfig = {
 *   plugins: [
 *     IcloudRelayPlugin.init({
 *       encryptionKey: process.env.ICLOUD_ENCRYPTION_KEY,
 *       syncIntervalSeconds: 120,
 *       retentionDays: 30,
 *     }),
 *   ],
 * };
 * ```
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [IcloudPrimaryAccount, IcloudVirtualEmail, IcloudReceivedMail, IcloudQueryAuditLog],
    controllers: [IcloudPortalController],
    providers: [
        IcloudCipherService,
        IcloudAccessCodeService,
        IcloudOtpExtractorService,
        IcloudMailSanitizerService,
        IcloudImapSyncService,
        IcloudAdminService,
        IcloudPublicQueryService,
        IcloudJobService,
    ],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [IcloudAdminResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [IcloudPublicResolver],
    },
    dashboard: './dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class IcloudRelayPlugin {
    static options: IcloudRelayPluginOptions = {};

    static init(options: IcloudRelayPluginOptions): typeof IcloudRelayPlugin {
        this.options = options;
        return IcloudRelayPlugin;
    }
}
