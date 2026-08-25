import { Injectable } from '@nestjs/common';
import {
    Asset,
    AssetService,
    ConfigService,
    isGraphQlErrorResult,
    RequestContext,
    UserInputError,
} from '@vendure/core';
import { Readable, Transform } from 'node:stream';

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp']);
const MIME_TYPE_EXTENSIONS: Record<string, string> = {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

interface RemoteImageStream extends Readable {
    headers?: Record<string, string | string[] | undefined>;
}

@Injectable()
export class StorefrontExternalImageService {
    constructor(
        private readonly configService: ConfigService,
        private readonly assetService: AssetService,
    ) {}

    async import(ctx: RequestContext, imageUrl: string): Promise<Asset> {
        try {
            const source =
                (await this.configService.importExportOptions.assetImportStrategy.getStreamFromPath(
                    imageUrl,
                )) as RemoteImageStream;
            const maxBytes = this.configService.assetOptions.uploadMaxFileSize;
            this.assertContentLength(source, maxBytes);
            const fileName = this.importFileName(imageUrl, source);
            const limitedStream = this.limitSize(source, maxBytes);
            const asset = await this.assetService.createFromFileStream(limitedStream, fileName, ctx);
            if (isGraphQlErrorResult(asset)) {
                throw new Error(asset.message);
            }
            return asset;
        } catch {
            throw new UserInputError(
                '外部图片导入失败。请确认地址可公开访问、未超过素材上传大小限制，并且是 JPG、PNG、WebP、GIF 或 AVIF 图片；也可以直接上传到素材库。',
            );
        }
    }

    storefrontUrl(asset: Asset): string {
        const identifier = (
            asset.mimeType === 'image/svg+xml' ? asset.source : asset.preview || asset.source
        ).trim();
        if (!identifier) return '';
        try {
            const url = new URL(identifier);
            return url.pathname.includes('/assets/') ? `${url.pathname}${url.search}${url.hash}` : '';
        } catch {
            const path = identifier.replace(/^\/+/, '');
            return path.startsWith('assets/') ? `/${path}` : `/assets/${path}`;
        }
    }

    private assertContentLength(stream: RemoteImageStream, maxBytes: number): void {
        const rawLength = stream.headers?.['content-length'];
        const contentLength = Number(Array.isArray(rawLength) ? rawLength[0] : rawLength);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
            stream.destroy();
            throw new Error('External image exceeds the asset upload limit');
        }
    }

    private importFileName(imageUrl: string, stream: RemoteImageStream): string {
        const rawContentType = stream.headers?.['content-type'];
        const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType)
            ?.split(';')[0]
            .trim()
            .toLowerCase();
        const contentTypeExtension = contentType ? MIME_TYPE_EXTENSIONS[contentType] : undefined;
        const pathExtension = new URL(imageUrl).pathname.match(/\.([a-z\d]+)$/i)?.[1]?.toLowerCase();
        const extension =
            contentTypeExtension ??
            (pathExtension && SUPPORTED_IMAGE_EXTENSIONS.has(pathExtension) ? pathExtension : undefined);
        if (!extension || (contentType?.startsWith('image/') && !contentTypeExtension)) {
            stream.destroy();
            throw new Error('External URL did not return a supported bitmap image');
        }
        return `storefront-external-image.${extension}`;
    }

    private limitSize(source: Readable, maxBytes: number): Readable {
        let bytesRead = 0;
        const limiter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                bytesRead += chunk.byteLength;
                if (bytesRead > maxBytes) {
                    callback(new Error('External image exceeds the asset upload limit'));
                    return;
                }
                callback(null, chunk);
            },
        });
        source.once('error', error => limiter.destroy(error));
        return source.pipe(limiter);
    }
}
