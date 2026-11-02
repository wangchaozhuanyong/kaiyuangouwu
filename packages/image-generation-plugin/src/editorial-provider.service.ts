import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';

import { ImageProviderCredential } from './entities/image-provider-credential.entity';
import { ImageProviderClient } from './provider/image-provider.client';
import { SafeProviderUrlService } from './security/safe-provider-url.service';
import { ImageProviderProtocol } from './types';
/** Server-side editorial calls only. No customer identity, wallet or private image-job storage. */
@Injectable()
export class EditorialProviderService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly client: ImageProviderClient,
        readonly safeUrls: SafeProviderUrlService,
    ) {}
    private async credential(ctx: RequestContext, code: string) {
        if (!ctx.userHasPermissions(['SuperAdmin' as never]) && ctx.apiType !== 'admin')
            throw new Error('编辑任务需要后台上下文');
        const row = await this.connection
            .getRepository(ctx, ImageProviderCredential)
            .findOne({ where: { code, enabled: true } });
        if (!row || row.archivedAt) throw new Error('编辑任务供应商未启用');
        return row;
    }
    async options(ctx: RequestContext) {
        const rows = await this.connection
            .getRepository(ctx, ImageProviderCredential)
            .find({ where: { enabled: true }, order: { priority: 'ASC' } });
        return rows
            .filter(x => !x.archivedAt)
            .map(x => ({ code: x.code, name: x.name, textModel: x.textModelId }));
    }
    async text(ctx: RequestContext, code: string, model: string, system: string, prompt: string) {
        const credential = await this.credential(ctx, code);
        if (!model || credential.purpose === 'IMAGE') throw new Error('文本模型未配置');
        return this.client.optimizePrompt(credential, model, system, prompt);
    }
    async image(
        ctx: RequestContext,
        code: string,
        model: string,
        protocol: string,
        prompt: string,
        key: string,
    ) {
        const credential = await this.credential(ctx, code);
        if (!model || credential.purpose === 'PROMPT') throw new Error('配图模型未配置');
        return this.client.generate(credential, protocol as ImageProviderProtocol, {
            providerModelId: model,
            prompt,
            aspectRatio: '16:9',
            idempotencyKey: key,
        });
    }
}
