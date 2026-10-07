import { ID } from '@vendure/common/lib/shared-types';
import { Customer, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { IsNull, MoreThan, MoreThanOrEqual } from 'typeorm';

import {
    MAX_ACTIVE_REFERENCE_ASSETS,
    MAX_ACTIVE_REFERENCE_BYTES,
    MAX_REFERENCE_BYTES,
    MAX_REFERENCE_UPLOADS_PER_DAY,
    MAX_REFERENCE_UPLOADS_PER_MINUTE,
} from './constants';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import { ImageGenerationConfigService } from './image-generation-config.service';
import { supportsGenerationLock } from './image-generation-helpers';
import { ImageGenerationJobViews } from './image-generation-job-views';
import { startOfBeijingDay } from './prompt/image-prompt-engine.service';
import { ImagePrivateStorageService, UploadedImageFile } from './storage/image-private-storage.service';

interface Dependencies {
    connection: TransactionalConnection;
    configService: ImageGenerationConfigService;
    storage: ImagePrivateStorageService;
    activeCustomer: (ctx: RequestContext) => Promise<Customer>;
}

/** Owns customer reference upload quotas and the private storage release boundary. */
export class ImageGenerationReferences {
    constructor(
        private readonly dependencies: Dependencies,
        private readonly views: ImageGenerationJobViews,
    ) {}

    async uploadReference(ctx: RequestContext, upload: Promise<UploadedImageFile>, termsAccepted: boolean) {
        if (!termsAccepted) throw new UserInputError('上传参考图前需确认拥有图片使用权并同意服务条款');
        const customer = await this.dependencies.activeCustomer(ctx);
        if (!(await this.dependencies.configService.shopConfig(ctx)).enabled)
            throw new UserInputError('当前店铺的 AI 图片工坊不可用');
        const file = await upload;
        const asset = await this.dependencies.connection.withTransaction(ctx, async txCtx => {
            await this.dependencies.configService.assertStorefrontEntryEnabled(txCtx);
            if (supportsGenerationLock(this.dependencies.connection.rawConnection.options.type)) {
                await this.dependencies.connection
                    .getRepository(txCtx, Customer)
                    .createQueryBuilder('customer')
                    .setLock('pessimistic_write')
                    .where('customer.id = :id', { id: customer.id })
                    .getOne();
            }
            const repository = this.dependencies.connection.getRepository(txCtx, ImagePrivateAsset);
            const now = Date.now();
            const [minuteCount, dayCount, activeCount, activeSize] = await Promise.all([
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        customerId: customer.id,
                        kind: 'REFERENCE',
                        createdAt: MoreThanOrEqual(new Date(now - 60_000)),
                    },
                }),
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        customerId: customer.id,
                        kind: 'REFERENCE',
                        createdAt: MoreThanOrEqual(startOfBeijingDay(now)),
                    },
                }),
                repository.count({
                    where: {
                        channelId: txCtx.channelId,
                        customerId: customer.id,
                        kind: 'REFERENCE',
                        deletedAt: IsNull(),
                        expiresAt: MoreThan(new Date()),
                    },
                }),
                repository
                    .createQueryBuilder('asset')
                    .select('COALESCE(SUM(asset.byteSize), 0)', 'total')
                    .where('asset.channelId = :channelId', { channelId: txCtx.channelId })
                    .andWhere('asset.customerId = :customerId', { customerId: customer.id })
                    .andWhere('asset.kind = :kind', { kind: 'REFERENCE' })
                    .andWhere('asset.deletedAt IS NULL')
                    .andWhere('asset.expiresAt > :now', { now: new Date() })
                    .getRawOne<{ total: string | number }>(),
            ]);
            if (minuteCount >= MAX_REFERENCE_UPLOADS_PER_MINUTE)
                throw new UserInputError('参考图每分钟最多上传 5 张，请稍后再试');
            if (dayCount >= MAX_REFERENCE_UPLOADS_PER_DAY)
                throw new UserInputError('今天的参考图上传额度已用完');
            if (activeCount >= MAX_ACTIVE_REFERENCE_ASSETS)
                throw new UserInputError('最多保留 10 张有效参考图，请等待过期后再上传');
            const remainingBytes = MAX_ACTIVE_REFERENCE_BYTES - Number(activeSize?.total ?? 0);
            if (remainingBytes <= 0) throw new UserInputError('参考图总容量已达到 100MB');
            return this.dependencies.storage.storeReference(
                txCtx,
                customer.id,
                file,
                Math.min(MAX_REFERENCE_BYTES, remainingBytes),
            );
        });
        return this.views.assetView(ctx, asset, customer.id);
    }

    async releaseReference(ctx: RequestContext, assetId: ID) {
        const customer = await this.dependencies.activeCustomer(ctx);
        return this.dependencies.storage.releaseReference(ctx, assetId, customer.id);
    }
}
