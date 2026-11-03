import { emptyBlogDraft } from '@vendure/storefront-content-plugin';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { BlogMediaService, coverSvg } from './media';
import { extractSkillImages, extractSourceImages, imageAllowed } from './source-images';
import { parseSource } from './sources';
describe('source image provenance and safe import', () => {
    it('keeps the same source identity when the headline changes and preserves distinct changelog entries', () => {
        const rss = (title: string) =>
            `<rss><item><title>${title}</title><link>https://openai.com/index/one/</link><pubDate>2026-11-02</pubDate></item></rss>`;
        expect(parseSource('openai', rss('Original title'))[0].eventKey).toBe(
            parseSource('openai', rss('Edited title'))[0].eventKey,
        );
    });
    it('extracts current-story metadata and figures, excluding thumbnails, related stories and hostile origins', () => {
        const html = [
            '<meta property="og:image" content="https://www-cdn.anthropic.com/images/cover.jpg"><main><',
            'aside><figure><img src="https://www-cdn.anthropic.com/images/unrelated.jpg"></figure></asi',
            'de><figure><img src="/_next/image?url=https%3A%2F%2Fwww-cdn.anthropic.com%2Fimages%2Fchart',
            '.png" alt="Actual chart"><figcaption>Official values</figcaption></figure><figure><img src',
            '="https://127.0.0.1/private"></figure></main>',
        ].join('');
        const images = extractSourceImages('anthropic', html, 'https://www.anthropic.com/news/release');
        expect(images.map(x => x.url)).toEqual([
            'https://www-cdn.anthropic.com/images/cover.jpg',
            'https://www-cdn.anthropic.com/images/chart.png',
        ]);
        expect(images[1].caption).toBe('Official values');
        expect(
            imageAllowed(
                'gemini-blog',
                'https://storage.googleapis.com/other-bucket/image.png',
                'https://blog.google/post',
            ),
        ).toBe(false);
        expect(
            imageAllowed(
                'openai',
                'https://openai.com.evil.test/image.jpg',
                'https://openai.com/index/post/',
            ),
        ).toBe(false);
    });
    it('binds Skill images to the verified repository and commit', () => {
        const images = extractSkillImages({
            repository: 'owner/repo',
            commit: 'a'.repeat(40),
            directory: 'skills/demo',
            body: '![Screenshot](images/demo.png) ![Other](https://evil.test/secret.png)',
        });
        expect(images).toHaveLength(1);
        expect(images[0].url).toBe(
            `https://raw.githubusercontent.com/owner/repo/${'a'.repeat(40)}/skills/demo/images/demo.png`,
        );
        expect(coverSvg({ ...emptyBlogDraft(), category: 'skills' })).not.toContain('编辑审核后发布');
    });
    it('imports and reuses source bytes without AI overlays and retains attribution', async () => {
        const bytes = await sharp({ create: { width: 1200, height: 600, channels: 3, background: 'white' } })
            .png()
            .toBuffer();
        let saved: any = null;
        let published: any[] = [];
        const writes: any[] = [];
        const q: any = {
            innerJoin: () => q,
            where: vi.fn(() => q),
            andWhere: () => q,
            getOne: () => Promise.resolve(saved),
            getMany: () => Promise.resolve(published),
        };
        const assets = {
            createFromFileStream: vi.fn(async (stream: any, name: string) => {
                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                writes.push(await sharp(Buffer.concat(chunks)).metadata());
                saved = { id: 4, name, preview: 'source.webp' };
                return saved;
            }),
        };
        const media = new BlogMediaService(
            assets as never,
            {
                withTransaction: (c: any, fn: any) => Promise.resolve(fn(c)),
                getRepository: (_c: any, type: any) => ({
                    createQueryBuilder: () =>
                        type.name === 'BlogSettings'
                            ? {
                                  update() {
                                      return this;
                                  },
                                  set() {
                                      return this;
                                  },
                                  where() {
                                      return this;
                                  },
                                  execute: () => Promise.resolve({ affected: 1 }),
                              }
                            : q,
                }),
            } as never,
            { image: () => Promise.resolve(bytes) } as never,
        );
        const candidate = {
            key: 'source',
            sourceCode: 'openai',
            sourcePageUrl: 'https://openai.com/index/release/',
            url: 'https://images.openai.com/image.png',
            alt: 'Original chart',
            caption: 'Official chart',
            credit: 'Publisher',
        };
        const cover = await media.importSource({ channelId: 1 } as never, candidate);
        await media.importSource({ channelId: 1 } as never, candidate);
        expect(assets.createFromFileStream).toHaveBeenCalledTimes(1);
        expect(cover).toMatchObject({
            kind: 'SOURCE',
            generated: false,
            rightsConfirmed: false,
            sourcePageUrl: candidate.sourcePageUrl,
            originalUrl: candidate.url,
            credit: 'Publisher',
        });
        expect(writes[0]).toMatchObject({ format: 'webp', width: 1200, height: 600 });
        published = [
            {
                publishedJson: JSON.stringify({
                    ...emptyBlogDraft(),
                    cover: { ...cover, rightsConfirmed: true },
                }),
            },
        ];
        expect((await media.importSource({ channelId: 1 } as never, candidate)).rightsConfirmed).toBe(true);
        expect(q.where).toHaveBeenCalledWith('article.channelId = :channelId', { channelId: 1 });
        expect(
            (
                await media.importSource({ channelId: 1 } as never, {
                    ...candidate,
                    sourcePageUrl: 'https://openai.com/index/another-story/',
                })
            ).rightsConfirmed,
        ).toBe(false);
        published = [];
        expect((await media.importSource({ channelId: 1 } as never, candidate)).rightsConfirmed).toBe(false);
        expect(assets.createFromFileStream).toHaveBeenCalledTimes(1);
        return Promise.resolve();
    });
    it('rejects invalid image bytes before creating an asset', async () => {
        const q: any = {
            innerJoin: () => q,
            where: () => q,
            andWhere: () => q,
            getOne: () => Promise.resolve(null),
        };
        const assets = { createFromFileStream: vi.fn() };
        const media = new BlogMediaService(
            assets as never,
            {
                withTransaction: (c: any, fn: any) => Promise.resolve(fn(c)),
                getRepository: (_c: any, type: any) => ({
                    createQueryBuilder: () =>
                        type.name === 'BlogSettings'
                            ? {
                                  update() {
                                      return this;
                                  },
                                  set() {
                                      return this;
                                  },
                                  where() {
                                      return this;
                                  },
                                  execute: () => Promise.resolve({ affected: 1 }),
                              }
                            : q,
                }),
            } as never,
            { image: () => Promise.resolve(Buffer.from('<svg><script>unsafe</script></svg>')) } as never,
        );
        await expect(
            media.importSource({ channelId: 1 } as never, {
                key: 'x',
                sourceCode: 'openai',
                sourcePageUrl: 'https://openai.com/index/post/',
                url: 'https://images.openai.com/x.svg',
                alt: '',
                caption: '',
                credit: '',
            }),
        ).rejects.toThrow();
        expect(assets.createFromFileStream).not.toHaveBeenCalled();
        return Promise.resolve();
    });
});
