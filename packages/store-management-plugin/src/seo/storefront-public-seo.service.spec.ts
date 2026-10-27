import 'reflect-metadata';

import { ServiceUnavailableException } from '@nestjs/common';
import { CurrencyCode, LanguageCode, type RequestContext } from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import type { PublicPageRequest, StorefrontPageData } from '@vendure/storefront-content-plugin';
import { describe, expect, it, vi } from 'vitest';

import { StoreProfile } from '../entities/store-profile.entity';

import { StorefrontPublicSeoService, type StorefrontPublicSeoInitial } from './storefront-public-seo.service';
import { defaultStorefrontSeoSettings, publicStorefrontSeoSettings } from './storefront-seo.contract';

function fixture() {
    const host = 'synthetic-store.invalid';
    const ctx = {
        channelId: 'synthetic-channel',
        channel: { code: 'synthetic-store' },
        languageCode: LanguageCode.en,
        currencyCode: CurrencyCode.MYR,
    } as RequestContext;
    const configuration = {
        payload: publicStorefrontSeoSettings({
            ...defaultStorefrontSeoSettings(),
            indexingEnabled: true,
            enabledLanguages: ['en'],
        }),
        version: 1,
        publishedAt: new Date('2026-10-21T00:00:00Z'),
    };
    const seo = {
        publishedConfiguration: vi.fn().mockResolvedValue(configuration),
        publishedRecord: vi.fn().mockResolvedValue(null),
    };
    const domains = { findOne: vi.fn().mockResolvedValue({ domain: host }) };
    const profile = { descriptionEn: 'Published description', descriptionZh: '' };
    const profiles = { findOne: vi.fn().mockResolvedValue(profile) };
    const connection = {
        getRepository: vi.fn((_ctx: RequestContext, entity: unknown) => {
            if (entity === StoreDomain) return domains;
            if (entity === StoreProfile) return profiles;
            throw new Error('Unexpected repository');
        }),
    };
    const pages = { getAccessMode: vi.fn().mockResolvedValue('LIVE') };
    const content = { findPublished: vi.fn().mockResolvedValue([]) };
    const service = new StorefrontPublicSeoService(
        seo as never,
        connection as never,
        pages as never,
        content as never,
        {} as never,
    );
    const page = {
        schemaVersion: 1,
        version: 'fixture',
        generatedAt: 1,
        scope: {
            host,
            channelCode: ctx.channel.code,
            languageCode: ctx.languageCode,
            currencyCode: ctx.currencyCode,
            priceContext: 'public',
        },
        request: { kind: 'home' },
        route: '/',
        failures: [],
        media: [],
        config: {
            accessMode: 'LIVE',
            customFields: { storefrontNameEn: 'Published store' },
            description: 'Published description',
            logoUrl: null,
        },
        content: { blocks: [{ type: 'HERO', title: 'Published heading' }] },
    } as StorefrontPageData;
    return { service, host, ctx, configuration, profile, seo, domains, profiles, pages, content, page };
}

describe('request-local public SEO preparation', () => {
    it.each(['terms', 'privacy'] as const)(
        'uses the published %s item body when the legal block overview is empty',
        async kind => {
            const test = fixture();
            test.page.request = { kind: 'page', id: kind };
            test.page.content = {
                blocks: [
                    {
                        type: 'LEGAL',
                        code: 'store-legal',
                        title: 'Legal documents',
                        subtitle: '',
                        body: '',
                        items: [
                            {
                                targetType: 'PAGE',
                                targetValue: 'terms',
                                label: 'Terms of use',
                                description: 'Published terms body',
                            },
                            {
                                targetType: 'PAGE',
                                targetValue: 'privacy',
                                label: 'Privacy Policy',
                                description: 'Published privacy body',
                            },
                        ],
                    },
                ],
            };
            const enriched = await test.service.enrich(test.ctx, test.host, test.page);
            expect(enriched.seo).toMatchObject({
                indexable: true,
                title: `${kind === 'terms' ? 'Terms of use' : 'Privacy Policy'} | Published store`,
                description: `Published ${kind} body`,
                reasons: [],
            });
        },
    );

    it.each(['missing-document', 'different-host'])(
        'keeps legal pages excluded when the matching document is unavailable: %s',
        async reason => {
            const test = fixture();
            test.page.request = { kind: 'page', id: 'terms' };
            test.page.content = {
                blocks: [
                    {
                        type: 'LEGAL',
                        code: 'store-legal',
                        title: 'Legal documents',
                        subtitle: '',
                        body: '',
                        items: [
                            {
                                targetType: 'PAGE',
                                targetValue: reason === 'missing-document' ? 'privacy' : 'terms',
                                label: 'Published document',
                                description:
                                    reason === 'different-host'
                                        ? 'Applies to other-store.invalid only.'
                                        : 'Published privacy body',
                            },
                        ],
                    },
                ],
            };
            const enriched = await test.service.enrich(test.ctx, test.host, test.page);
            expect(enriched.seo?.indexable).toBe(false);
            expect(enriched.seo?.robots).toContain('noindex');
        },
    );

    it('starts independent document and profile reads while configuration is still pending', async () => {
        const test = fixture();
        let resolveConfiguration!: (value: typeof test.configuration) => void;
        test.seo.publishedConfiguration.mockReturnValue(
            new Promise(resolve => {
                resolveConfiguration = resolve;
            }),
        );

        const pending = test.service.prepare(test.ctx, test.host, { kind: 'home' });

        expect(test.domains.findOne).toHaveBeenCalledOnce();
        expect(test.seo.publishedRecord).toHaveBeenCalledWith(test.ctx, {
            targetType: 'HOME',
            targetId: 'home',
            languageCode: 'en',
        });
        expect(test.profiles.findOne).toHaveBeenCalledOnce();
        resolveConfiguration(test.configuration);
        await expect(pending).resolves.toMatchObject({
            configuration: test.configuration,
            primary: test.host,
            record: null,
            profile: test.profile,
            scope: {
                channelId: 'synthetic-channel',
                channelCode: 'synthetic-store',
                languageCode: 'en',
                currencyCode: 'MYR',
                host: test.host,
                requestKey: '{"kind":"home"}',
            },
        });
    });

    it.each([true, false])('reuses supplied configuration and primary, including null: %s', async present => {
        const test = fixture();
        const initial: StorefrontPublicSeoInitial = {
            configuration: present ? test.configuration : null,
            primary: present ? test.host : null,
        };

        const prepared = await test.service.prepare(test.ctx, test.host, { kind: 'home' }, initial);
        const enriched = await test.service.enrich(test.ctx, test.host, test.page, prepared);

        expect(prepared.configuration).toBe(initial.configuration);
        expect(prepared.primary).toBe(initial.primary);
        expect(enriched.seo?.version).toBe(present ? 1 : 0);
        expect(test.seo.publishedConfiguration).not.toHaveBeenCalled();
        expect(test.domains.findOne).not.toHaveBeenCalled();
        expect(test.seo.publishedRecord).toHaveBeenCalledOnce();
        expect(test.profiles.findOne).toHaveBeenCalledOnce();
        expect(test.pages.getAccessMode).toHaveBeenCalledOnce();
    });

    it('keeps preparation automatic for callers that only supply the page', async () => {
        const test = fixture();

        const enriched = await test.service.enrich(test.ctx, test.host, test.page);

        expect(enriched.seo).toMatchObject({
            canonical: `https://${test.host}/en/`,
            version: 1,
            title: 'Published store | Published store',
        });
        expect(test.seo.publishedConfiguration).toHaveBeenCalledOnce();
        expect(test.domains.findOne).toHaveBeenCalledOnce();
        expect(test.pages.getAccessMode).toHaveBeenCalledOnce();
    });

    it.each(['channelId', 'channelCode', 'languageCode', 'currencyCode', 'host', 'requestKey'] as const)(
        'rejects preparation for a different %s before consuming its metadata',
        async field => {
            const test = fixture();
            const prepared = await test.service.prepare(test.ctx, test.host, { kind: 'home' });
            const ctx = {
                ...test.ctx,
                ...(field === 'channelId' ? { channelId: 'another-channel' } : {}),
                ...(field === 'channelCode' ? { channel: { code: 'another-store' } } : {}),
                ...(field === 'languageCode' ? { languageCode: LanguageCode.zh_Hans } : {}),
                ...(field === 'currencyCode' ? { currencyCode: CurrencyCode.USD } : {}),
            } as RequestContext;
            const host = field === 'host' ? 'another-store.invalid' : test.host;
            const page =
                field === 'requestKey'
                    ? { ...test.page, request: { kind: 'page', id: 'support' } as PublicPageRequest }
                    : test.page;

            await expect(test.service.enrich(ctx, host, page, prepared)).rejects.toThrow(
                'Public SEO preparation scope changed',
            );
            expect(test.pages.getAccessMode).not.toHaveBeenCalled();
            expect(test.content.findPublished).not.toHaveBeenCalled();
        },
    );

    it('still reads closure state after preparation before returning enriched metadata', async () => {
        const test = fixture();
        const prepared = await test.service.prepare(test.ctx, test.host, { kind: 'home' });
        test.pages.getAccessMode.mockResolvedValue('CLOSED');

        await expect(test.service.enrich(test.ctx, test.host, test.page, prepared)).rejects.toMatchObject({
            code: 'STOREFRONT_CLOSED',
        });
        expect(test.pages.getAccessMode).toHaveBeenCalledOnce();
    });

    it('does not reuse prepared publication or domain reads in the final output authority check', async () => {
        const test = fixture();
        const prepared = await test.service.prepare(
            test.ctx,
            test.host,
            { kind: 'home' },
            {
                configuration: test.configuration,
                primary: test.host,
            },
        );
        const enriched = await test.service.enrich(test.ctx, test.host, test.page, prepared);
        test.seo.publishedConfiguration.mockResolvedValue({ ...test.configuration, version: 2 });

        await expect(test.service.assertOutput(test.ctx, enriched)).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
        expect(test.seo.publishedConfiguration).toHaveBeenCalledOnce();
        expect(test.domains.findOne).toHaveBeenCalledOnce();
        expect(test.seo.publishedRecord).toHaveBeenCalledTimes(2);
        expect(test.pages.getAccessMode).toHaveBeenCalledTimes(2);
    });
});
