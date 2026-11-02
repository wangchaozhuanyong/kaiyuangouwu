import { Injectable } from '@nestjs/common';
import { Asset, AssetService, RequestContext, TransactionalConnection } from '@vendure/core';
import {
    BlogCover,
    BlogDraft,
    BlogSourceImage,
    blogBodySections,
    blogCategoryLabels,
    storefrontAssetUrl,
} from '@vendure/storefront-content-plugin';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';

import { BlogSettings } from './entities';
import { BlogSourceHttp } from './source-http';
const escape = (s: string) =>
    s.replace(
        /[&<>"']/gu,
        x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[x] ?? x,
    );
/** Fixed artwork pixels, not DOM typography. The title is drawn after image generation. */
export function coverSvg(draft: BlogDraft, withBackdrop = true): string {
    const lines = Array.from(draft.title)
        .reduce<string[]>((rows, char) => {
            if (!rows.length || Array.from(rows[rows.length - 1]).length >= 18) rows.push('');
            rows[rows.length - 1] += char;
            return rows;
        }, [])
        .slice(0, 4);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    ${
        withBackdrop
            ? [
                  '<rect width="1600" height="900" fill="#edf0f5"/><circle cx="1370" cy="210" r="310" fill="#',
                  'dce3ee"/><path d="M1100 700L1350 400 1550 700Z" fill="#ccd6e6"/>',
              ].join('')
            : '<rect y="180" width="1600" height="720" fill="#f8fafc" fill-opacity="0.90"/>'
    }
    <g font-family="sans-serif" fill="#202b3b"><text x="110" y="170" font-size="40">${escape(blogCategoryLabels[draft.category])} · AI 资讯</text>
    ${lines.map((line, index) => `<text x="110" y="${330 + index * 95}" font-size="64" font-weight="700">${escape(line)}</text>`).join('')}
    <text x="110" y="825" font-size="28">主题封面 · 根据本文内容整理</text></g></svg>`;
}
@Injectable()
export class BlogMediaService {
    constructor(
        private readonly assets: AssetService,
        private readonly connection: TransactionalConnection,
        private readonly http: BlogSourceHttp,
    ) {}
    async importSource(ctx: RequestContext, image: BlogSourceImage): Promise<BlogCover> {
        const bytes = await this.http.image(image.sourceCode, image.url, image.sourcePageUrl);
        const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
        const gif = /^GIF8[79]a/u.test(bytes.toString('ascii', 0, 6));
        if (!png && !jpeg && !webp && !gif) throw new Error('来源图片文件签名无效');
        const key = createHash('sha256').update(bytes).digest('hex');
        const name = `news-blog-source-${ctx.channelId}-${key}.webp`;
        const importedAsset = await this.connection.withTransaction(ctx, async tx => {
            // Serialize content-addressed import per store; concurrent articles reuse one Asset.
            await this.connection
                .getRepository(tx, BlogSettings)
                .createQueryBuilder()
                .update()
                .set({ version: () => 'version' })
                .where('channelId = :id', { id: tx.channelId })
                .execute();
            let asset = await this.connection
                .getRepository(tx, Asset)
                .createQueryBuilder('a')
                .innerJoin('a.channels', 'c')
                .innerJoin('a.translations', 'translation')
                .where('translation.name = :name', { name })
                .andWhere('c.id = :id', { id: ctx.channelId })
                .getOne();
            if (!asset) {
                const picture = sharp(bytes, { limitInputPixels: 40000000, animated: false });
                const metadata = await picture.metadata();
                if (
                    !['jpeg', 'png', 'webp', 'gif'].includes(metadata.format ?? '') ||
                    !metadata.width ||
                    !metadata.height ||
                    metadata.width > 12000 ||
                    metadata.height > 12000
                )
                    throw new Error('来源图片尺寸或格式无效');
                const result = await this.assets.createFromFileStream(
                    Readable.from(
                        await picture
                            .rotate()
                            .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                            .webp({ quality: 85 })
                            .toBuffer(),
                    ),
                    name,
                    tx,
                );
                if (!('id' in result)) throw new Error('来源图片保存失败');
                asset = result;
            }
            return asset;
        });
        return {
            assetId: String(importedAsset.id),
            url: storefrontAssetUrl(importedAsset),
            alt: image.alt || image.caption || '资讯原文配图',
            generated: false,
            kind: 'SOURCE',
            sourcePageUrl: image.sourcePageUrl,
            originalUrl: image.url,
            credit: image.credit,
            rightsConfirmed: false,
        };
    }
    async createCover(
        ctx: RequestContext,
        draft: BlogDraft,
        key: string,
        background?: Buffer,
    ): Promise<BlogCover> {
        const overlay = Buffer.from(coverSvg(draft, !background));
        const pipeline = background
            ? sharp(background)
                  .resize(1600, 900, { fit: 'cover' })
                  .composite([{ input: overlay }])
            : sharp(overlay);
        const bytes = await pipeline.webp({ quality: 82 }).toBuffer();
        const stream = Readable.from(bytes);
        const asset = await this.assets.createFromFileStream(
            stream,
            `news-blog-${key.slice(0, 24)}.webp`,
            ctx,
        );
        if (!('id' in asset)) throw new Error('封面素材保存失败');
        return {
            assetId: String(asset.id),
            url: storefrontAssetUrl(asset),
            alt: `${draft.title}（${background ? 'AI 示意图' : '主题封面'}）`,
            generated: Boolean(background),
            kind: background ? 'AI' : 'TEMPLATE',
        };
    }
    async createIllustrations(ctx: RequestContext, draft: BlogDraft, key: string) {
        const labels =
            draft.format === 'GUIDE'
                ? blogBodySections(draft.body)
                      .map(x => x.title)
                      .filter(Boolean)
                      .slice(0, 4)
                : draft.format === 'COMPARISON'
                  ? draft.facts.slice(0, 3).map(x => x.text)
                  : [];
        if (labels.length < 2) return [];
        const rows = labels
            .map((label, index) => {
                const parts =
                    Array.from(label)
                        .slice(0, 66)
                        .join('')
                        .match(/.{1,22}/gu) ?? [];
                return [
                    '<g transform="translate(80,',
                    `${130 + index * 170}`,
                    ')"><rect width="1440" height="150" rx="16" fill="#ffffff"/><text x="36" y="54" font-size="',
                    '30" fill="#334155">',
                    `${index + 1}`,
                    '</text>',
                    `${parts.map((part, line) => `<text x="110" y="${44 + line * 38}" font-size="30" fill="#202b3b">${escape(part)}</text>`).join('')}`,
                    '</g>',
                ].join('');
            })
            .join('');
        const svg = [
            '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" heigh',
            't="900" fill="#edf0f5"/><g font-family="sans-serif"><text x="80" y="80" font-size="36" fil',
            'l="#202b3b">',
            `${draft.format === 'GUIDE' ? '操作流程示意' : '来源要点对照'}`,
            '</text>',
            `${rows}`,
            '<text x="80" y="865" font-size="24" fill="#475569">依据本文参考来源整理 · 编辑审核后发布</text></g></svg>',
        ].join('');
        const bytes = await sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
        const asset = await this.assets.createFromFileStream(
            Readable.from(bytes),
            `news-blog-diagram-${key.slice(0, 24)}.webp`,
            ctx,
        );
        if (!('id' in asset)) throw new Error('正文配图保存失败');
        return [
            {
                assetId: String(asset.id),
                url: storefrontAssetUrl(asset),
                alt: draft.format === 'GUIDE' ? '本文操作流程示意' : '本文来源要点对照',
                generated: true,
                caption: '根据本文参考来源整理的示意图，具体条件以来源说明为准。',
            },
        ];
    }
}
