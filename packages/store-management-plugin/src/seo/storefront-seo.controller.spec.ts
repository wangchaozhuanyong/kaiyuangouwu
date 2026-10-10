import 'reflect-metadata';

import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { RequestContext } from '@vendure/core';
import type { StorefrontPageData } from '@vendure/storefront-content-plugin';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontClosedError } from '../storefront-activation.service';

import { defaultStorefrontSeoSettings } from './storefront-seo.contract';
import {
    normalizedPublicRedirectPath,
    publicRedirectTracking,
    StorefrontSeoController,
} from './storefront-seo.controller';

function responseMock() {
    const response = {
        status: vi.fn(),
        type: vi.fn(),
        send: vi.fn(),
        end: vi.fn(),
        setHeader: vi.fn(),
        redirect: vi.fn(),
    };
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);
    response.send.mockReturnValue(response);
    response.end.mockReturnValue(response);
    return response;
}

function fixture() {
    const ctx = {
        channelId: 'synthetic-channel',
        languageCode: 'en',
        currencyCode: 'MYR',
        channel: {
            id: 'synthetic-channel',
            defaultLanguageCode: 'en',
            defaultCurrencyCode: 'MYR',
            availableCurrencyCodes: ['MYR'],
        },
    } as unknown as RequestContext;
    const page = {
        request: { kind: 'product', id: 'product-1' },
        scope: { host: 'synthetic-store.invalid' },
        config: { accessMode: 'LIVE' },
        failures: [],
        seo: { robots: 'index, follow', version: 1, documentVersion: 1 },
    } as unknown as StorefrontPageData;
    const settings = defaultStorefrontSeoSettings();
    const access = {
        resolveRequest: vi.fn().mockResolvedValue({ ctx, host: 'synthetic-store.invalid' }),
    };
    const contexts = { create: vi.fn().mockResolvedValue(ctx) };
    const pages = { read: vi.fn().mockResolvedValue(page) };
    const publicSeo = {
        primaryHost: vi.fn().mockResolvedValue('synthetic-store.invalid'),
        enrich: vi.fn().mockResolvedValue(page),
        assertOutput: vi.fn().mockResolvedValue(undefined),
    };
    const html = { render: vi.fn().mockResolvedValue('<html>synthetic public body</html>') };
    const seo = { publishedSettings: vi.fn().mockResolvedValue(settings) };
    const controller = new StorefrontSeoController(
        access as never,
        contexts as never,
        pages as never,
        publicSeo as never,
        html as never,
        seo as never,
    );
    const req = (path: string, trusted = true) =>
        ({
            socket: { remoteAddress: trusted ? '127.0.0.1' : '203.0.113.10' },
            headers: {
                host: 'synthetic-store.invalid',
                'x-storefront-original-uri': path,
                cookie: 'synthetic-only-cookie',
                authorization: 'synthetic-only-authorization',
            },
            query: {},
        }) as unknown as Request;
    return { controller, ctx, page, settings, access, contexts, pages, publicSeo, html, seo, req };
}

describe('StorefrontSeoController public document and legacy redirects', () => {
    it.each(['document', 'legacyRedirect'] as const)(
        '%s handles a published unknown old slug before parsing or reading page content',
        async method => {
            const test = fixture();
            test.settings.redirects.push({
                from: '/old-buyer-guide',
                to: '/en/guides/buyer-guide',
                status: 301,
            });
            const response = responseMock();

            await test.controller[method](test.req('/old-buyer-guide'), response as unknown as Response);

            expect(response.redirect).toHaveBeenCalledWith(301, '/en/guides/buyer-guide');
            expect(test.pages.read).not.toHaveBeenCalled();
            expect(test.html.render).not.toHaveBeenCalled();
            expect(test.contexts.create).not.toHaveBeenCalled();
        },
    );

    it('matches semantic query parameters regardless of their order', async () => {
        const test = fixture();
        test.settings.redirects.push({
            from: '/old-category?collectionId=collection-1&page=2',
            to: '/en/category?collectionId=collection-2&page=2',
            status: 308,
        });
        const response = responseMock();

        await test.controller.legacyRedirect(
            test.req('/old-category?page=2&collectionId=collection-1'),
            response as unknown as Response,
        );

        expect(response.redirect).toHaveBeenCalledWith(308, '/en/category?collectionId=collection-2&page=2');
    });

    it.each(['document', 'legacyRedirect'] as const)(
        '%s matches old paths with tracking parameters and preserves those parameters on the target',
        async method => {
            const test = fixture();
            test.settings.redirects.push({ from: '/old-guide', to: '/en/guides/buyer-guide', status: 301 });
            const response = responseMock();

            await test.controller[method](
                test.req('/old-guide?utm_source=synthetic&utm_campaign=october&gclid=synthetic-click'),
                response as unknown as Response,
            );

            expect(response.redirect).toHaveBeenCalledWith(
                301,
                '/en/guides/buyer-guide?utm_source=synthetic&utm_campaign=october&gclid=synthetic-click',
            );
            expect(test.pages.read).not.toHaveBeenCalled();
        },
    );

    it('does not mistake unknown private parameters for a configured legacy mapping', async () => {
        const test = fixture();
        test.settings.redirects.push({ from: '/old-guide', to: '/en/guides/buyer-guide', status: 301 });
        const response = responseMock();

        await test.controller.legacyRedirect(
            test.req('/old-guide?utm_source=synthetic&token=synthetic-private'),
            response as unknown as Response,
        );

        expect(response.status).toHaveBeenCalledWith(404);
        expect(response.redirect).not.toHaveBeenCalled();
        expect(response.send).not.toHaveBeenCalled();
    });

    it('normalizes locale and primary host while dropping private and unrelated parameters', async () => {
        const test = fixture();
        test.publicSeo.primaryHost.mockResolvedValue('primary-synthetic.invalid');
        const response = responseMock();

        await test.controller.document(
            test.req(
                '/product?id=product-1&utm_source=synthetic&token=synthetic-private&session=synthetic-session',
            ),
            response as unknown as Response,
        );

        expect(response.redirect).toHaveBeenCalledWith(
            301,
            'https://primary-synthetic.invalid/en/product?id=product-1&utm_source=synthetic',
        );
        expect(test.pages.read).not.toHaveBeenCalled();
    });

    it('ignores an untrusted original-uri header and uses the explicit query path', async () => {
        const test = fixture();
        test.settings.redirects.push({
            from: '/spoofed-old-guide',
            to: '/en/guides/spoofed-guide',
            status: 301,
        });
        const request = test.req('/spoofed-old-guide', false);
        request.query.path = '/en/product?id=product-1';
        const response = responseMock();

        await test.controller.document(request, response as unknown as Response);

        expect(response.redirect).not.toHaveBeenCalled();
        expect(test.pages.read).toHaveBeenCalledWith(test.ctx, 'synthetic-store.invalid', {
            kind: 'product',
            id: 'product-1',
        });
        expect(response.status).toHaveBeenCalledWith(200);
    });

    it('renders then rechecks authority before sending a successful anonymous HTML response', async () => {
        const test = fixture();
        const response = responseMock();

        await test.controller.document(test.req('/en/product?id=product-1'), response as unknown as Response);

        expect(test.html.render.mock.invocationCallOrder[0]).toBeLessThan(
            test.publicSeo.assertOutput.mock.invocationCallOrder[0],
        );
        expect(test.publicSeo.assertOutput.mock.invocationCallOrder[0]).toBeLessThan(
            response.send.mock.invocationCallOrder[0],
        );
        expect(test.contexts.create).toHaveBeenCalledWith(
            expect.objectContaining({
                apiType: 'shop',
                languageCode: 'en',
                currencyCode: 'MYR',
                req: expect.objectContaining({ headers: { host: 'synthetic-store.invalid' } }),
            }),
        );
        expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(response.setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'index, follow');
        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.send).toHaveBeenCalledWith('<html>synthetic public body</html>');
    });

    it.each([
        { error: new ServiceUnavailableException('Authority changed during rendering'), status: 503 },
        { error: new NotFoundException('Publication withdrawn during rendering'), status: 404 },
    ])(
        'never sends the rendered body or 200 when the final authority check fails with $status',
        async ({ error, status }) => {
            const test = fixture();
            test.publicSeo.assertOutput.mockRejectedValue(error);
            const response = responseMock();

            await test.controller.document(
                test.req('/en/product?id=product-1'),
                response as unknown as Response,
            );

            expect(test.html.render).toHaveBeenCalled();
            expect(response.status).toHaveBeenCalledWith(status);
            expect(response.status).not.toHaveBeenCalledWith(200);
            expect(response.send).not.toHaveBeenCalledWith('<html>synthetic public body</html>');
            expect(response.setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex, follow');
        },
    );

    it('passes a closure during rendering to the closed-store filter without sending public HTML', async () => {
        const test = fixture();
        const error = new StorefrontClosedError();
        test.publicSeo.assertOutput.mockRejectedValue(error);
        const response = responseMock();

        await expect(
            test.controller.document(test.req('/en/product?id=product-1'), response as unknown as Response),
        ).rejects.toBe(error);

        expect(test.html.render).toHaveBeenCalled();
        expect(response.status).not.toHaveBeenCalledWith(200);
        expect(response.send).not.toHaveBeenCalled();
    });

    it('returns 503 before rendering when required public content is unavailable', async () => {
        const test = fixture();
        test.page.failures.push('content');
        const response = responseMock();

        await test.controller.document(test.req('/en/product?id=product-1'), response as unknown as Response);

        expect(test.html.render).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(503);
        expect(response.status).not.toHaveBeenCalledWith(200);
    });

    it('returns 404 for an unknown old slug without a published mapping', async () => {
        const test = fixture();
        const response = responseMock();

        await test.controller.legacyRedirect(
            test.req('/unmapped-old-guide'),
            response as unknown as Response,
        );

        expect(response.status).toHaveBeenCalledWith(404);
        expect(response.end).toHaveBeenCalled();
        expect(response.redirect).not.toHaveBeenCalled();
    });
});

describe('public redirect normalization', () => {
    it('sorts identity parameters and ignores only supported tracking fields', () => {
        expect(normalizedPublicRedirectPath('/old-category?page=2&utm_source=synthetic&collectionId=1')).toBe(
            '/old-category?collectionId=1&page=2',
        );
        expect(normalizedPublicRedirectPath('/old-guide?token=synthetic-private&utm_source=synthetic')).toBe(
            '/old-guide?token=synthetic-private',
        );
    });

    it.each(['//external.invalid/path', '/bad\\path', '/bad\npath', '/bad#fragment', '/old?id=1&id=2'])(
        'rejects ambiguous or unsafe source %s',
        value => {
            expect(normalizedPublicRedirectPath(value)).toBeNull();
        },
    );

    it('keeps destination tracking values and copies only bounded, non-control tracking values', () => {
        const target = new URL(
            publicRedirectTracking(
                '/en/product?id=1&utm_source=destination',
                `/old?utm_source=source&utm_medium=email&utm_term=${'a'.repeat(251)}&utm_content=%0A&token=synthetic-private`,
            ),
            'https://synthetic-store.invalid',
        );
        expect(target.searchParams.get('utm_source')).toBe('destination');
        expect(target.searchParams.get('utm_medium')).toBe('email');
        expect(target.searchParams.has('utm_term')).toBe(false);
        expect(target.searchParams.has('utm_content')).toBe(false);
        expect(target.searchParams.has('token')).toBe(false);
    });
});
