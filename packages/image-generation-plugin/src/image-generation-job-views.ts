import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { In, IsNull } from 'typeorm';

import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImagePrivateAsset } from './entities/image-private-asset.entity';
import { publicOutputError, storedReferenceAssetIds } from './image-generation-helpers';
import { ImagePrivateStorageService } from './storage/image-private-storage.service';
/** Projects owned jobs and assets into customer and catalog API views. */
export class ImageGenerationJobViews {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly storage: ImagePrivateStorageService,
    ) {}

    async jobView(ctx: RequestContext, job: ImageGenerationJob, customerId: ID) {
        const referenceAssetIds = storedReferenceAssetIds(job);
        const assets = referenceAssetIds.length
            ? await this.connection.getRepository(ctx, ImagePrivateAsset).find({
                  where: {
                      id: In(referenceAssetIds),
                      channelId: ctx.channelId,
                      customerId,
                      kind: 'REFERENCE',
                      deletedAt: IsNull(),
                  },
              })
            : [];
        const byId = new Map(assets.map(asset => [String(asset.id), asset]));
        const outputs = job.outputs ?? [];
        return {
            ...job,
            referenceAssetIds,
            referenceAssets: referenceAssetIds.map(id => {
                const asset = byId.get(id);
                return asset && asset.expiresAt.getTime() > Date.now()
                    ? this.assetView(ctx, asset, customerId)
                    : null;
            }),
            referenceInstruction: job.promptSpec?.referenceInstruction ?? null,
            optimizedPrompt:
                job.promptSpec?.inputSnapshot?.version === 1
                    ? job.promptSpec.inputSnapshot.optimizedPrompt
                    : null,
            inputSnapshotVersion: job.promptSpec?.inputSnapshot?.version ?? null,
            errorMessage:
                outputs.map(publicOutputError).find((message): message is string => Boolean(message)) ?? null,
            referenceAsset: job.referenceAsset ? this.assetView(ctx, job.referenceAsset, customerId) : null,
            outputs: outputs.map(output => ({
                ...output,
                providerRequestId: null,
                errorMessage: publicOutputError(output),
                width: output.asset?.width ?? null,
                height: output.asset?.height ?? null,
                imageUrl: output.asset ? this.storage.signedUrl(ctx, output.asset, customerId) : null,
                downloadUrl: output.asset
                    ? this.storage.signedUrl(ctx, output.asset, customerId, true)
                    : null,
            })),
        };
    }

    assetView(ctx: RequestContext, asset: ImagePrivateAsset, customerId: ID) {
        return { ...asset, previewUrl: this.storage.signedUrl(ctx, asset, customerId) };
    }

    catalogAssetView(ctx: RequestContext, asset: ImagePrivateAsset, administratorUserId: ID) {
        return { ...asset, previewUrl: this.storage.signedAdminUrl(ctx, asset, administratorUserId) };
    }

    catalogJobView(ctx: RequestContext, job: ImageGenerationJob, administratorUserId: ID) {
        const outputs = job.outputs ?? [];
        return {
            ...job,
            productName: String(job.promptSpec?.catalogProductName ?? ''),
            description: String(job.promptSpec?.catalogDescription ?? ''),
            errorMessage:
                outputs.map(publicOutputError).find((message): message is string => Boolean(message)) ?? null,
            referenceAsset: job.referenceAsset
                ? this.catalogAssetView(ctx, job.referenceAsset, administratorUserId)
                : null,
            outputs: outputs.map(output => ({
                ...output,
                providerRequestId: null,
                errorMessage: publicOutputError(output),
                width: output.asset?.width ?? null,
                height: output.asset?.height ?? null,
                imageUrl: output.asset
                    ? this.storage.signedAdminUrl(ctx, output.asset, administratorUserId)
                    : null,
            })),
        };
    }
}
