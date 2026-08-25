import { Injectable } from '@nestjs/common';
import { Asset, ConfigService, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { StorefrontContentBlock } from '@vendure/storefront-content-plugin';
import type { Request } from 'express';

import { StoreProfile } from '../entities/store-profile.entity';
import { StorefrontPromotionPage } from '../entities/storefront-promotion-page.entity';
import {
    StorefrontPromotionContentType,
    StorefrontPromotionPageView,
    UpdateStorefrontPromotionDraftInput,
} from '../types';

import {
    StorefrontPromotionBindings,
    StorefrontPromotionHtmlService,
} from './storefront-promotion-html.service';

interface StorefrontChannelFields {
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
}

@Injectable()
export class StorefrontPromotionService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly configService: ConfigService,
        private readonly htmlService: StorefrontPromotionHtmlService,
    ) {}

    async getForAdmin(ctx: RequestContext): Promise<StorefrontPromotionPageView> {
        const page = await this.findPage(ctx);
        return this.toView(ctx, page);
    }

    async saveDraft(
        ctx: RequestContext,
        input: UpdateStorefrontPromotionDraftInput,
    ): Promise<StorefrontPromotionPageView> {
        const source = this.htmlService.validateSource(input.contentType, input.source);
        const repository = this.connection.getRepository(ctx, StorefrontPromotionPage);
        let page = await this.findPage(ctx);
        if (!page) {
            page = new StorefrontPromotionPage({
                channel: ctx.channel,
                channelId: ctx.channelId,
                contentType: input.contentType,
                draftSource: source,
                publishedContentType: 'HTML',
                publishedSource: null,
                isCustomized: true,
                defaultTemplateVersion: this.htmlService.defaultTemplateVersion,
                publishedVersion: 0,
                publishedAt: null,
            });
        } else {
            page.contentType = input.contentType;
            page.draftSource = source;
            page.isCustomized = true;
        }
        return this.toView(ctx, await repository.save(page));
    }

    async publish(ctx: RequestContext): Promise<StorefrontPromotionPageView> {
        const page = await this.getPageOrThrow(ctx);
        if (!page.draftSource) {
            throw new UserInputError('请先保存推广页草稿');
        }
        page.publishedContentType = page.contentType;
        page.publishedSource = this.htmlService.validateSource(page.contentType, page.draftSource);
        page.isCustomized = true;
        page.publishedVersion += 1;
        page.publishedAt = new Date();
        return this.toView(ctx, await this.connection.getRepository(ctx, StorefrontPromotionPage).save(page));
    }

    async resetToDefault(ctx: RequestContext): Promise<StorefrontPromotionPageView> {
        const repository = this.connection.getRepository(ctx, StorefrontPromotionPage);
        let page = await this.findPage(ctx);
        if (!page) {
            page = new StorefrontPromotionPage({
                channel: ctx.channel,
                channelId: ctx.channelId,
                contentType: 'HTML',
                draftSource: null,
                publishedContentType: 'HTML',
                publishedSource: null,
                isCustomized: false,
                defaultTemplateVersion: this.htmlService.defaultTemplateVersion,
                publishedVersion: 1,
                publishedAt: new Date(),
            });
        } else {
            page.contentType = 'HTML';
            page.draftSource = null;
            page.publishedContentType = 'HTML';
            page.publishedSource = null;
            page.isCustomized = false;
            page.defaultTemplateVersion = this.htmlService.defaultTemplateVersion;
            page.publishedVersion += 1;
            page.publishedAt = new Date();
        }
        return this.toView(ctx, await repository.save(page));
    }

    async preview(ctx: RequestContext, input: UpdateStorefrontPromotionDraftInput): Promise<string> {
        const source = this.htmlService.validateSource(input.contentType, input.source);
        const bindings = await this.getBindings(ctx);
        return this.htmlService.render({
            contentType: input.contentType,
            source,
            bindings,
            entryTicket: 'dashboard-preview',
            canonicalUrl: await this.getPublicUrl(ctx),
        });
    }

    async renderPublished(ctx: RequestContext, entryTicket: string): Promise<string> {
        const page = await this.findPage(ctx);
        const customSource = page?.isCustomized ? page.publishedSource : null;
        const contentType: StorefrontPromotionContentType =
            customSource && page ? page.publishedContentType : 'HTML';
        const source = customSource ?? this.htmlService.defaultTemplate;
        return this.htmlService.render({
            contentType,
            source,
            bindings: await this.getBindings(ctx),
            entryTicket,
            canonicalUrl: await this.getPublicUrl(ctx),
        });
    }

    private async findPage(ctx: RequestContext): Promise<StorefrontPromotionPage | null> {
        return this.connection.getRepository(ctx, StorefrontPromotionPage).findOne({
            where: { channelId: ctx.channelId },
        });
    }

    private async getPageOrThrow(ctx: RequestContext): Promise<StorefrontPromotionPage> {
        const page = await this.findPage(ctx);
        if (!page) {
            throw new UserInputError('请先保存推广页草稿');
        }
        return page;
    }

    private async toView(
        ctx: RequestContext,
        page: StorefrontPromotionPage | null,
    ): Promise<StorefrontPromotionPageView> {
        return {
            id: page?.id ?? null,
            contentType: page?.contentType ?? 'HTML',
            draftSource: page?.draftSource ?? this.htmlService.defaultTemplate,
            publishedSource: page?.publishedSource ?? null,
            isCustomized: Boolean(page?.draftSource),
            defaultTemplateVersion: this.htmlService.defaultTemplateVersion,
            publishedVersion: page?.publishedVersion ?? 0,
            publishedAt: page?.publishedAt ?? null,
            publicUrl: await this.getPublicUrl(ctx),
        };
    }

    private async getBindings(ctx: RequestContext): Promise<StorefrontPromotionBindings> {
        const [profile, hero] = await Promise.all([
            this.connection.getRepository(ctx, StoreProfile).findOne({
                where: { channelId: ctx.channelId },
                relations: { logoAsset: true },
            }),
            this.findActiveHero(ctx),
        ]);
        const fields = ctx.channel.customFields as StorefrontChannelFields;
        const isEnglish = String(ctx.languageCode).toLowerCase().startsWith('en');
        const name =
            (isEnglish ? fields.storefrontNameEn : fields.storefrontNameZh)?.trim() ||
            fields.storefrontNameZh?.trim() ||
            fields.storefrontNameEn?.trim() ||
            ctx.channel.code;
        const description = this.truncate(
            (isEnglish ? profile?.descriptionEn : profile?.descriptionZh)?.trim() ||
                profile?.descriptionZh?.trim() ||
                profile?.descriptionEn?.trim() ||
                '',
            220,
        );
        const logoUrl = profile?.logoAsset
            ? this.webpMediaUrl(this.assetUrl(ctx.req, profile.logoAsset), 'storefront-thumbnail-320')
            : '';
        const heroSource = hero?.imageAsset
            ? this.assetUrl(ctx.req, hero.imageAsset)
            : this.legacyAssetUrl(ctx.req, hero?.imageUrl);
        const heroImageUrl = this.webpMediaUrl(heroSource, 'storefront-hero-1440') || logoUrl;
        return {
            'store.name': name,
            'store.description': description,
            'store.logoUrl': logoUrl,
            'store.heroImageUrl': heroImageUrl,
            'store.currentYear': String(new Date().getFullYear()),
            'store.language': isEnglish ? 'en' : 'zh-CN',
        };
    }

    private async findActiveHero(ctx: RequestContext): Promise<StorefrontContentBlock | null> {
        const heroes = await this.connection.getRepository(ctx, StorefrontContentBlock).find({
            where: { channelId: ctx.channelId, type: 'HERO', enabled: true },
            relations: { imageAsset: true },
            order: { position: 'ASC', createdAt: 'ASC' },
        });
        const now = Date.now();
        return (
            heroes.find(hero => {
                const started = !hero.startsAt || hero.startsAt.getTime() <= now;
                const notEnded = !hero.endsAt || hero.endsAt.getTime() > now;
                return (
                    started && notEnded && Boolean(hero.imageAsset || this.isLegacyAssetUrl(hero.imageUrl))
                );
            }) ?? null
        );
    }

    private async getPublicUrl(ctx: RequestContext): Promise<string | null> {
        const domain = await this.connection.getRepository(ctx, StoreDomain).findOne({
            where: { channelId: ctx.channelId, isPrimary: true, status: 'ACTIVE' },
            select: { domain: true },
        });
        if (domain) {
            return `https://${domain.domain}/promo`;
        }
        if (ctx.apiType === 'admin') return null;
        const host = ctx.req?.headers.host;
        if (!host) return null;
        const protocol = ctx.req?.protocol || 'http';
        return `${protocol}://${host}/promo`;
    }

    private assetUrl(req: Request | undefined, asset: Asset): string {
        return this.mediaUrl(
            req,
            asset.mimeType === 'image/svg+xml' ? asset.source : asset.preview || asset.source,
        );
    }

    private mediaUrl(req: Request | undefined, identifier: string): string {
        const normalized = identifier.trim();
        if (!normalized) return '';
        if (/^(?:https?:|data:image\/)/i.test(normalized)) return normalized;
        const storageStrategy = this.configService.assetOptions.assetStorageStrategy;
        if (req && storageStrategy.toAbsoluteUrl) {
            return storageStrategy.toAbsoluteUrl(req, normalized.replace(/^\/assets\//, ''));
        }
        return normalized.startsWith('/') ? normalized : `/assets/${normalized}`;
    }

    private webpMediaUrl(identifier: string, preset: string): string {
        if (!identifier) return '';
        let url: URL;
        try {
            url = new URL(identifier, 'https://storefront.invalid');
        } catch {
            return '';
        }
        if (!url.pathname.includes('/assets/')) return '';
        if (url.pathname.toLowerCase().endsWith('.svg')) return identifier;

        url.searchParams.set('preset', preset);
        url.searchParams.set('format', 'webp');
        url.searchParams.set('q', '75');
        const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(identifier) || identifier.startsWith('//');
        return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
    }

    private legacyAssetUrl(req: Request | undefined, identifier: string | null | undefined): string {
        return this.isLegacyAssetUrl(identifier) ? this.mediaUrl(req, identifier as string) : '';
    }

    private isLegacyAssetUrl(identifier: string | null | undefined): boolean {
        return Boolean(identifier?.trim().startsWith('/assets/'));
    }

    private truncate(value: string, maxLength: number): string {
        const characters = Array.from(value);
        return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join('')}…` : value;
    }
}
