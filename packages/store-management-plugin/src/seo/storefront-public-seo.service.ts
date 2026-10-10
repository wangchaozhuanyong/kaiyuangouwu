import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    Collection,
    LanguageCode,
    Product,
    PUBLIC_PRODUCT_SUMMARY_READER,
    RequestContext,
    TransactionalConnection,
    type PublicProductDetail,
    type PublicProductSummaryReader,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import {
    StorefrontContentService,
    type PublicPageRequest,
    type StorefrontPageData,
} from '@vendure/storefront-content-plugin';
import { In, IsNull, Not } from 'typeorm';

import { StoreProfile } from '../entities/store-profile.entity';
import { StorefrontPromotionService } from '../promotion/storefront-promotion.service';
import { StorefrontClosedError } from '../storefront-activation.service';
import { StorefrontPublicPageService } from '../storefront-public-page.service';

import { resolvePromotionSeo } from './storefront-promotion-seo';
import { buildPublicSeoDocument, publicRobots, sitemapXml } from './storefront-seo-output';
import { type StorefrontSeoIdentity, type StorefrontSeoLanguage } from './storefront-seo.contract';
import { StorefrontSeoService } from './storefront-seo.service';

type PublicConfig = {
    customFields?: { storefrontNameZh?: string; storefrontNameEn?: string };
    description?: string;
    logoUrl?: string | null;
    legalEntityName?: string;
    supportEmail?: string;
};
type PublicBlock = { type: string; title?: string; body?: string; subtitle?: string };
const plain = (value: string | null | undefined) =>
    (value ?? '')
        .replace(/<[^>]*>/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
const language = (ctx: RequestContext): StorefrontSeoLanguage =>
    ctx.languageCode === LanguageCode.zh_Hans ? 'zh_Hans' : 'en';
const SHARD_SIZE = 500;

function identity(request: PublicPageRequest, code: StorefrontSeoLanguage): StorefrontSeoIdentity {
    if (request.kind === 'home') return { targetType: 'HOME', targetId: 'home', languageCode: code };
    if (request.kind === 'product')
        return { targetType: 'PRODUCT', targetId: request.id, languageCode: code };
    if (request.kind === 'article')
        return { targetType: 'ARTICLE', targetId: request.id, languageCode: code };
    if (request.kind === 'page') return { targetType: 'PAGE', targetId: request.id, languageCode: code };
    return { targetType: 'COLLECTION', targetId: request.input.collectionId ?? 'all', languageCode: code };
}

@Injectable()
export class StorefrontPublicSeoService {
    constructor(
        private readonly seo: StorefrontSeoService,
        private readonly connection: TransactionalConnection,
        private readonly pages: StorefrontPublicPageService,
        private readonly content: StorefrontContentService,
        private readonly moduleRef: ModuleRef,
    ) {}

    async primaryHost(ctx: RequestContext): Promise<string | null> {
        const row = await this.connection.getRepository(ctx, StoreDomain).findOne({
            where: { channelId: ctx.channelId, isPrimary: true, status: 'ACTIVE', verifiedAt: Not(IsNull()) },
        });
        return row?.domain ?? null;
    }

    private async product(ctx: RequestContext, id: string) {
        const entity = await this.connection.getRepository(ctx, Product).findOne({
            where: { id, enabled: true, deletedAt: IsNull() },
            relations: ['channels', 'translations'],
        });
        if (!entity || !entity.channels.some(channel => String(channel.id) === String(ctx.channelId)))
            return null;
        return entity;
    }

    private async collection(ctx: RequestContext, id: string) {
        const entity = await this.connection.getRepository(ctx, Collection).findOne({
            where: { id, isPrivate: false },
            relations: ['channels', 'translations'],
        });
        if (!entity || !entity.channels.some(channel => String(channel.id) === String(ctx.channelId)))
            return null;
        return entity;
    }

    async enrich(ctx: RequestContext, host: string, page: StorefrontPageData): Promise<StorefrontPageData> {
        const request = page.request ?? { kind: 'home' };
        const code = language(ctx);
        const [configuration, primaryHost, documentRecord, profile] = await Promise.all([
            this.seo.publishedConfiguration(ctx),
            this.primaryHost(ctx),
            this.seo.publishedRecord(ctx, identity(request, code)),
            this.connection.getRepository(ctx, StoreProfile).findOne({ where: { channelId: ctx.channelId } }),
        ]);
        const settings = configuration?.payload ?? null;
        const document = documentRecord?.payload ?? null;
        const config = page.config as PublicConfig;
        const blocks = (page.content as { blocks?: PublicBlock[] } | undefined)?.blocks ?? [];
        const names = config.customFields ?? {};
        const storeName = plain(code === 'zh_Hans' ? names.storefrontNameZh : names.storefrontNameEn);
        let title = storeName;
        let description = plain(config.description);
        let image = config.logoUrl ?? null;
        let completeLanguages: StorefrontSeoLanguage[] = [];
        const storeLanguages = (['zh_Hans', 'en'] as const).filter(
            candidate =>
                plain(candidate === 'zh_Hans' ? names.storefrontNameZh : names.storefrontNameEn) &&
                plain(candidate === 'zh_Hans' ? profile?.descriptionZh : profile?.descriptionEn),
        );
        const structuredData: Array<Record<string, unknown>> = [];
        const origin = `https://${primaryHost ?? host}`;
        const website = {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            '@id': `${origin}/#website`,
            name: storeName,
            url: origin,
        };
        if (storeName) structuredData.push(website);
        if (config.legalEntityName || storeName) {
            const organization = settings?.organization;
            const local =
                organization?.businessType === 'LocalBusiness' &&
                organization.publicAddress &&
                organization.reviewedAt &&
                organization.evidenceUrl;
            structuredData.push({
                '@context': 'https://schema.org',
                '@type': local ? 'LocalBusiness' : 'Organization',
                '@id': `${origin}/#organization`,
                name: config.legalEntityName || storeName,
                url: origin,
                ...(image ? { logo: new URL(image, origin).href } : {}),
                ...(config.supportEmail ? { email: config.supportEmail } : {}),
                ...(organization?.sameAs.length ? { sameAs: organization.sameAs } : {}),
                ...(local
                    ? { address: organization.publicAddress, areaServed: organization.serviceAreas }
                    : {}),
            });
        }
        if (request.kind === 'product') {
            const entity = await this.product(ctx, request.id);
            const product = page.product as PublicProductDetail | null;
            if (!entity || !product) throw new NotFoundException('Public product not found');
            completeLanguages = (['zh_Hans', 'en'] as const).filter(candidate =>
                entity.translations.some(
                    translation =>
                        translation.languageCode === (candidate as LanguageCode) &&
                        plain(translation.name) &&
                        plain(translation.description),
                ),
            );
            title = product.name;
            description = plain(product.description);
            image = product.featuredAsset?.preview ?? image;
            const quoteOnly = product.customFields.pricingMode === 'QUOTE_ONLY';
            const variants = product.variants.filter(
                variant => variant.currencyCode === page.scope.currencyCode,
            );
            const lowest = variants.reduce<(typeof variants)[number] | undefined>(
                (selected, variant) =>
                    !selected || variant.priceWithTax < selected.priceWithTax ? variant : selected,
                undefined,
            );
            const offers =
                !quoteOnly && lowest
                    ? {
                          '@type': 'Offer',
                          price: (lowest.priceWithTax / 100).toFixed(2),
                          priceCurrency: lowest.currencyCode,
                          availability: this.availability(lowest),
                          url: `${origin}/${code === 'zh_Hans' ? 'zh' : 'en'}/product?id=${encodeURIComponent(request.id)}`,
                      }
                    : undefined;
            structuredData.push({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: title,
                description,
                ...(image ? { image: [new URL(image, origin).href] } : {}),
                ...(lowest?.sku ? { sku: lowest.sku } : {}),
                ...(offers ? { offers } : {}),
            });
        } else if (request.kind === 'catalog') {
            if (request.input.collectionId) {
                const entity = await this.collection(ctx, request.input.collectionId);
                if (!entity) throw new NotFoundException('Public category not found');
                completeLanguages = (['zh_Hans', 'en'] as const).filter(candidate =>
                    entity.translations.some(
                        translation =>
                            translation.languageCode === (candidate as LanguageCode) &&
                            plain(translation.name) &&
                            plain(translation.description),
                    ),
                );
                const matchingTranslation = entity.translations.find(
                    item => item.languageCode === (code as LanguageCode),
                );
                title = matchingTranslation?.name ?? '';
                description = plain(matchingTranslation?.description);
            } else {
                completeLanguages = storeLanguages;
                title = code === 'zh_Hans' ? '商品' : 'Products';
            }
            if ((request.input.skip ?? 0) >= (page.catalog?.totalItems ?? 0) && (request.input.skip ?? 0) > 0)
                throw new NotFoundException('Public category page not found');
        } else if (request.kind === 'article') {
            if (
                !document?.article?.body.trim() ||
                !document.article.reviewerName ||
                !document.article.reviewedAt
            )
                throw new NotFoundException('Published guide not found');
            const published = (await this.seo.listPublished(ctx, ['ARTICLE'])).filter(
                item => item.targetId === request.id,
            );
            completeLanguages = published
                .filter(
                    item =>
                        item.payload.title && item.payload.article?.body && item.payload.article.reviewedAt,
                )
                .map(item => item.languageCode as StorefrontSeoLanguage);
            const row = published.find(item => item.languageCode === code);
            const publishedAt = new Date(row?.publishedAt ?? document.article.reviewedAt).toISOString();
            const related = await Promise.all(
                document.article.relatedProductIds.map(id =>
                    this.moduleRef
                        .get<PublicProductSummaryReader>(PUBLIC_PRODUCT_SUMMARY_READER, { strict: false })
                        .byId(ctx, id),
                ),
            );
            page = {
                ...page,
                publicContent: {
                    id: request.id,
                    title: document.title,
                    body: document.article.body,
                    summary: document.article.summary,
                    authorName: document.article.authorName,
                    reviewerName: document.article.reviewerName,
                    sources: document.article.sources,
                    reviewedAt: document.article.reviewedAt,
                    publishedAt,
                    relatedProducts: related
                        .filter(item => item !== null)
                        .map(item => ({ id: item.id, name: item.name })),
                },
            };
            title = document.title;
            description = document.article.summary;
            structuredData.push({
                '@context': 'https://schema.org',
                '@type': 'Article',
                headline: title,
                description,
                ...(document.article.authorName
                    ? { author: { '@type': 'Person', name: document.article.authorName } }
                    : {}),
                datePublished: publishedAt,
                dateModified: document.article.reviewedAt,
                citation: document.article.sources.map(source => source.url),
            });
        } else if (request.kind === 'page') {
            const type =
                request.id === 'support' ? 'SUPPORT' : request.id === 'services' ? 'CLIENT_PLUGINS' : 'LEGAL';
            const block = blocks.find(item => item.type === type);
            title = block?.title ?? '';
            description = plain(block?.body ?? block?.subtitle);
            if (block && plain(block.body || block.title)) {
                // findPublished enforces real translations, schedules and publication for this locale.
                completeLanguages = storeLanguages.includes(code) ? [code] : [];
                for (const alternative of storeLanguages.filter(item => item !== code)) {
                    const alternateCtx = ctx.copy({ languageCode: alternative as LanguageCode });
                    const alternateBlocks = await this.content.findPublished(alternateCtx);
                    if (alternateBlocks.some(item => item.type === type && plain(item.body || item.title)))
                        completeLanguages.push(alternative);
                }
            }
            if (request.id === 'services' && block?.title && block.body)
                structuredData.push({
                    '@context': 'https://schema.org',
                    '@type': 'Service',
                    name: block.title,
                    description: plain(block.body),
                    provider: { '@id': `${origin}/#organization` },
                });
        } else {
            if (
                blocks.some(block => plain(block.title || block.body)) &&
                !page.failures.includes('content')
            ) {
                completeLanguages = storeLanguages.includes(code) ? [code] : [];
                for (const alternative of storeLanguages.filter(item => item !== code)) {
                    const alternateBlocks = await this.content.findPublished(
                        ctx.copy({ languageCode: alternative as LanguageCode }),
                    );
                    if (alternateBlocks.some(item => plain(item.title || item.body)))
                        completeLanguages.push(alternative);
                }
            }
        }
        const mode = await this.pages.getAccessMode(ctx);
        if (mode === 'CLOSED') throw new StorefrontClosedError();
        const seo = buildPublicSeoDocument(
            request,
            {
                host,
                primaryHost,
                channelCode: ctx.channel.code,
                languageCode: code,
                mode,
                title,
                storeName,
                description,
                image,
                completeLanguages,
                structuredData,
            },
            settings,
            document,
            configuration?.version ?? 0,
            documentRecord?.version ?? 0,
        );
        if (seo.indexable && (!title || !description || page.failures.includes('content'))) {
            seo.indexable = false;
            seo.robots = 'noindex, follow';
            seo.alternates = [];
            seo.reasons.push('PUBLIC_BODY_INCOMPLETE');
        }
        if (request.kind === 'catalog' || request.kind === 'product')
            seo.structuredData.push({
                '@context': 'https://schema.org',
                '@type': 'BreadcrumbList',
                itemListElement: [
                    {
                        '@type': 'ListItem',
                        position: 1,
                        name: storeName,
                        item: `${origin}/${code === 'zh_Hans' ? 'zh' : 'en'}/`,
                    },
                    { '@type': 'ListItem', position: 2, name: title, item: seo.canonical },
                ],
            });
        return { ...page, seo };
    }

    /** Rendering can outlive a committed closure or publication. Recheck before sending bytes. */
    async assertOutput(ctx: RequestContext, page: StorefrontPageData): Promise<void> {
        const [mode, configuration, primary, record] = await Promise.all([
            this.pages.getAccessMode(ctx),
            this.seo.publishedConfiguration(ctx),
            this.primaryHost(ctx),
            this.seo.publishedRecord(ctx, identity(page.request ?? { kind: 'home' }, language(ctx))),
        ]);
        if (mode === 'CLOSED') throw new StorefrontClosedError();
        const publicSeo = page.seo;
        if (!publicSeo)
            throw new ServiceUnavailableException('Public authority unavailable during rendering');
        const request = page.request;
        const entity =
            request?.kind === 'product'
                ? await this.product(ctx, request.id)
                : request?.kind === 'catalog' && request.input.collectionId
                  ? await this.collection(ctx, request.input.collectionId)
                  : undefined;
        if (entity === null) throw new NotFoundException('Public entity no longer available');
        if (
            publicSeo.indexable &&
            entity &&
            !entity.translations.some(
                item => item.languageCode === ctx.languageCode && plain(item.name) && plain(item.description),
            )
        )
            throw new ServiceUnavailableException('Public language content changed during rendering');
        if (
            mode !== (page.config as { accessMode?: string }).accessMode ||
            (configuration?.version ?? 0) !== publicSeo.version ||
            (record?.version ?? 0) !== (publicSeo.documentVersion ?? 0) ||
            Boolean(primary) !== !publicSeo.reasons.includes('PRIMARY_DOMAIN_NOT_VERIFIED') ||
            new URL(publicSeo.canonical).host !== (primary ?? page.scope.host)
        )
            throw new ServiceUnavailableException('Public authority changed during rendering');
    }

    async assertDiscovery(ctx: RequestContext, primary: string, version: number): Promise<void> {
        const [mode, configuration, currentPrimary] = await Promise.all([
            this.pages.getAccessMode(ctx),
            this.seo.publishedConfiguration(ctx),
            this.primaryHost(ctx),
        ]);
        if (mode === 'CLOSED') throw new StorefrontClosedError();
        if (
            mode !== 'LIVE' ||
            !configuration?.payload.indexingEnabled ||
            configuration.version !== version ||
            currentPrimary !== primary
        )
            throw new ServiceUnavailableException('Public discovery changed during read');
    }

    private availability(variant: PublicProductDetail['variants'][number]) {
        const autoCard =
            variant.customFields.fulfillmentType === 'digital' &&
            variant.customFields.digitalDeliveryMode === 'auto_card';
        const stock = autoCard ? (variant.autoCardAvailableStock ?? 0) : variant.saleableStockLevel;
        return stock == null || stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
    }

    async robots(ctx: RequestContext) {
        const [configuration, primary, mode] = await Promise.all([
            this.seo.publishedConfiguration(ctx),
            this.primaryHost(ctx),
            this.pages.getAccessMode(ctx),
        ]);
        const settings = configuration?.payload;
        return publicRobots(settings ?? null, primary, mode === 'LIVE');
    }

    async sitemap(
        ctx: RequestContext,
        host: string,
        kind: 'index' | 'pages' | 'products' | 'collections' = 'index',
        shard = 0,
    ) {
        const [configuration, primary, mode] = await Promise.all([
            this.seo.publishedConfiguration(ctx),
            this.primaryHost(ctx),
            this.pages.getAccessMode(ctx),
        ]);
        const settings = configuration?.payload;
        if (!configuration || !primary || mode !== 'LIVE' || !settings?.indexingEnabled)
            return sitemapXml([], kind === 'index');
        if (!Number.isSafeInteger(shard) || shard < 0 || shard > 2000)
            throw new NotFoundException('Sitemap not found');
        const reader = this.moduleRef.get<PublicProductSummaryReader>(PUBLIC_PRODUCT_SUMMARY_READER, {
            strict: false,
        });
        if (kind === 'index') {
            const products = await reader.list(ctx, { take: 1 });
            const collections = await this.connection
                .getRepository(ctx, Collection)
                .createQueryBuilder('collection')
                .innerJoin('collection.channels', 'channel', 'channel.id = :channelId', {
                    channelId: ctx.channelId,
                })
                .where('collection.isPrivate = :private', { private: false })
                .getCount();
            const paths = [
                '/sitemap-pages.xml',
                ...Array.from(
                    { length: Math.ceil(products.totalItems / SHARD_SIZE) },
                    (_, number) => `/sitemap-products-${number}.xml`,
                ),
                ...Array.from(
                    { length: Math.ceil(collections / SHARD_SIZE) },
                    (_, number) => `/sitemap-collections-${number}.xml`,
                ),
            ];
            await this.assertDiscovery(ctx, primary, configuration.version);
            return sitemapXml(
                paths.map(path => ({ url: `https://${primary}${path}` })),
                true,
            );
        }
        const overrides = await this.seo.listPublished(
            ctx,
            kind === 'products'
                ? ['PRODUCT']
                : kind === 'collections'
                  ? ['COLLECTION']
                  : ['HOME', 'PAGE', 'ARTICLE'],
        );
        const overrideVersion = (items: typeof overrides) =>
            JSON.stringify(
                items.map(item => [item.targetType, item.targetId, item.languageCode, item.publishedVersion]),
            );
        const initialOverrideVersion = overrideVersion(overrides);
        const noindex = (target: string, id: string, code: string) =>
            overrides.some(
                item =>
                    item.targetType === target &&
                    item.targetId === id &&
                    item.languageCode === code &&
                    item.payload.indexMode === 'NOINDEX',
            );
        const entries: Array<{ url: string; lastmod?: string }> = [];
        if (kind === 'pages') {
            const requests: PublicPageRequest[] = [
                { kind: 'home' },
                ...(['services', 'support', 'terms', 'privacy'] as const).map(id => ({
                    kind: 'page' as const,
                    id,
                })),
                ...Array.from(
                    new Set(
                        overrides.filter(item => item.targetType === 'ARTICLE').map(item => item.targetId),
                    ),
                ).map(id => ({ kind: 'article' as const, id })),
            ];
            for (const code of settings.enabledLanguages) {
                const localizedCtx = ctx.copy({ languageCode: code as LanguageCode });
                for (const request of requests) {
                    try {
                        const page = await this.enrich(
                            localizedCtx,
                            host,
                            await this.pages.read(localizedCtx, host, request),
                        );
                        if (page.seo?.indexable)
                            entries.push({
                                url: page.seo.canonical,
                                ...(page.publicContent ? { lastmod: page.publicContent.reviewedAt } : {}),
                            });
                    } catch (error) {
                        if (!(error instanceof NotFoundException)) throw error;
                    }
                }
                const promoRecord = await this.seo.publishedRecord(localizedCtx, {
                    targetType: 'PAGE',
                    targetId: 'promo',
                    languageCode: code,
                });
                if (promoRecord) {
                    const profile = await this.connection
                        .getRepository(localizedCtx, StoreProfile)
                        .findOne({ where: { channelId: ctx.channelId } });
                    const names = ctx.channel.customFields as {
                        storefrontNameZh?: string;
                        storefrontNameEn?: string;
                    };
                    const complete = Boolean(
                        plain(code === 'zh_Hans' ? names?.storefrontNameZh : names?.storefrontNameEn) &&
                        plain(code === 'zh_Hans' ? profile?.descriptionZh : profile?.descriptionEn),
                    );
                    const html = await this.moduleRef
                        .get(StorefrontPromotionService, { strict: false })
                        .renderPublished(localizedCtx, 'sitemap-discovery');
                    const promo = resolvePromotionSeo({
                        html,
                        host,
                        primaryHost: primary,
                        channelCode: ctx.channel.code,
                        languageCode: code,
                        mode,
                        settings,
                        document: promoRecord.payload,
                        settingsVersion: configuration.version,
                        documentVersion: promoRecord.version,
                        languageContentComplete: complete,
                    });
                    if (promo.seo.indexable) entries.push({ url: promo.seo.canonical });
                }
            }
        } else if (kind === 'products') {
            const items = await reader.list(ctx, { take: SHARD_SIZE, skip: shard * SHARD_SIZE });
            const entities = items.items.length
                ? await this.connection.getRepository(ctx, Product).find({
                      where: { id: In(items.items.map(item => item.id)), enabled: true, deletedAt: IsNull() },
                      relations: ['translations'],
                  })
                : [];
            for (const entity of entities)
                for (const code of settings.enabledLanguages) {
                    if (
                        !entity.translations.some(
                            item =>
                                item.languageCode === (code as LanguageCode) &&
                                plain(item.name) &&
                                plain(item.description),
                        ) ||
                        noindex('PRODUCT', String(entity.id), code)
                    )
                        continue;
                    entries.push({
                        url: `https://${primary}/${code === 'zh_Hans' ? 'zh' : 'en'}/product?id=${encodeURIComponent(entity.id)}`,
                        lastmod: entity.updatedAt.toISOString(),
                    });
                }
        } else {
            const entities = await this.connection
                .getRepository(ctx, Collection)
                .createQueryBuilder('collection')
                .innerJoin('collection.channels', 'channel', 'channel.id = :channelId', {
                    channelId: ctx.channelId,
                })
                .leftJoinAndSelect('collection.translations', 'translation')
                .where('collection.isPrivate = :private', { private: false })
                .orderBy('collection.id', 'ASC')
                .skip(shard * SHARD_SIZE)
                .take(SHARD_SIZE)
                .getMany();
            for (const entity of entities)
                for (const code of settings.enabledLanguages) {
                    if (
                        entity.isRoot ||
                        !entity.translations.some(
                            item =>
                                item.languageCode === (code as LanguageCode) &&
                                plain(item.name) &&
                                plain(item.description),
                        ) ||
                        noindex('COLLECTION', String(entity.id), code)
                    )
                        continue;
                    entries.push({
                        url: `https://${primary}/${code === 'zh_Hans' ? 'zh' : 'en'}/category?collectionId=${encodeURIComponent(entity.id)}`,
                        lastmod: entity.updatedAt.toISOString(),
                    });
                }
        }
        await this.assertDiscovery(ctx, primary, configuration.version);
        const currentOverrides = await this.seo.listPublished(
            ctx,
            kind === 'products'
                ? ['PRODUCT']
                : kind === 'collections'
                  ? ['COLLECTION']
                  : ['HOME', 'PAGE', 'ARTICLE'],
        );
        if (overrideVersion(currentOverrides) !== initialOverrideVersion)
            throw new ServiceUnavailableException('Published discovery pages changed during read');
        return sitemapXml(entries);
    }
}
