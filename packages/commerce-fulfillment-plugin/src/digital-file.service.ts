import { Injectable } from '@nestjs/common';
import { ConfigService, ID, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { DigitalDeliveryTokenService } from './digital-delivery-token.service';
import { DigitalFileVersion } from './entities/digital-product.entity';

export interface PrivateDigitalUpload {
    filename: string;
    createReadStream(): Readable;
}

@Injectable()
export class DigitalFileService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly tokens: DigitalDeliveryTokenService,
        private readonly config: ConfigService,
    ) {}

    async upload(ctx: RequestContext, upload: Promise<PrivateDigitalUpload>) {
        if (ctx.channel.code === '__default_channel__')
            throw new UserInputError('请选择具体店铺后上传交付文件');
        const file = await upload;
        const extension = path.extname(file.filename).toLowerCase();
        if (!['.zip', '.pdf', '.txt', '.md'].includes(extension))
            throw new UserInputError('交付文件支持 ZIP、PDF、TXT、MD');
        const root = this.tokens.privateStorageRoot;
        if (!root) throw new UserInputError('私有交付存储尚未配置，请联系管理员');
        const storageKey = `private/${String(ctx.channelId)}/${randomUUID()}${extension}`;
        const destination = this.tokens.pathForStorageKey(storageKey);
        if (!destination) throw new UserInputError('私有文件存储路径无效');
        await mkdir(path.dirname(destination), { recursive: true });
        if (this.tokens.pathForStorageKey(storageKey) !== destination)
            throw new UserInputError('私有文件存储路径已变化');
        const hash = createHash('sha256');
        let size = 0;
        const maximum = this.config.assetOptions.uploadMaxFileSize;
        const meter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                size += chunk.length;
                if (size > maximum) return callback(new UserInputError('交付文件超过后台上传大小限制'));
                hash.update(chunk);
                callback(null, chunk);
            },
        });
        try {
            await pipeline(
                file.createReadStream(),
                meter,
                createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
            );
            if (!size) throw new UserInputError('不能上传空文件');
            return await this.connection.getRepository(ctx, DigitalFileVersion).save(
                new DigitalFileVersion({
                    channelId: ctx.channelId,
                    fileName: path
                        .basename(file.filename)
                        .replace(/[\r\n\u0000-\u001f]/g, '')
                        .slice(0, 255),
                    storageKey,
                    size,
                    sha256: hash.digest('hex'),
                }),
            );
        } catch (error) {
            await unlink(destination).catch(() => undefined);
            throw error;
        }
    }

    async resource(channelId: ID, versionId: ID) {
        const version = await this.connection.rawConnection
            .getRepository(DigitalFileVersion)
            .findOne({ where: { id: versionId, channelId } });
        if (!version) return;
        const filePath = this.tokens.pathForStorageKey(version.storageKey);
        if (!filePath || !(await stat(filePath).catch(() => undefined))?.isFile()) return;
        return { path: filePath, downloadName: version.fileName };
    }
}
