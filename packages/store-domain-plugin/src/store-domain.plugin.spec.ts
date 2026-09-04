import 'reflect-metadata';

import { afterEach, describe, expect, it } from 'vitest';

import { StoreDomainPlugin } from './store-domain.plugin';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
    if (originalNodeEnv == null) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = originalNodeEnv;
    }
});

describe('StoreDomainPlugin production defaults', () => {
    it('keeps local token routing available in development', () => {
        process.env.NODE_ENV = 'development';

        StoreDomainPlugin.init({ cnameTarget: 'stores.example.com' });

        expect(StoreDomainPlugin.options.routingMode).toBe('prefer-domain');
        expect(StoreDomainPlugin.options.bypassHosts).toEqual(['localhost', '127.0.0.1']);
    });

    it('defaults to strict host routing with no bypass hosts in production', () => {
        process.env.NODE_ENV = 'production';

        StoreDomainPlugin.init({ cnameTarget: 'stores.example.com' });

        expect(StoreDomainPlugin.options.routingMode).toBe('require-domain');
        expect(StoreDomainPlugin.options.bypassHosts).toEqual([]);
    });

    it('rejects insecure routing and local CNAME targets in production', () => {
        process.env.NODE_ENV = 'production';

        expect(() =>
            StoreDomainPlugin.init({
                cnameTarget: 'stores.example.com',
                routingMode: 'prefer-domain',
            }),
        ).toThrow('must use require-domain');
        expect(() => StoreDomainPlugin.init({ cnameTarget: 'vendure.localhost' })).toThrow(
            'public CNAME target',
        );
    });

    it('normalizes a complete Cloudflare for SaaS configuration', () => {
        process.env.NODE_ENV = 'production';
        const fetchImpl = (() => Promise.resolve(new Response())) as typeof fetch;

        StoreDomainPlugin.init({
            cnameTarget: 'domains.example.com',
            cloudflare: {
                apiToken: ' scoped-token ',
                saasZoneId: ' zone-id ',
                fallbackOrigin: 'ORIGIN.EXAMPLE.COM',
                autoManageDns: true,
                apiBaseUrl: 'https://api.cloudflare.test/client/v4/',
                fetch: fetchImpl,
            },
        });

        expect(StoreDomainPlugin.options.cloudflare).toMatchObject({
            apiToken: 'scoped-token',
            saasZoneId: 'zone-id',
            fallbackOrigin: 'origin.example.com',
            autoManageDns: true,
            apiBaseUrl: 'https://api.cloudflare.test/client/v4',
            fetch: fetchImpl,
        });
    });

    it('rejects incomplete or insecure production Cloudflare configuration', () => {
        process.env.NODE_ENV = 'production';

        expect(() =>
            StoreDomainPlugin.init({
                cnameTarget: 'domains.example.com',
                cloudflare: { apiToken: '', saasZoneId: 'zone-id', fallbackOrigin: 'origin.example.com' },
            }),
        ).toThrow('requires apiToken');
        expect(() =>
            StoreDomainPlugin.init({
                cnameTarget: 'domains.example.com',
                cloudflare: {
                    apiToken: 'scoped-token',
                    saasZoneId: 'zone-id',
                    fallbackOrigin: 'origin.example.com',
                    apiBaseUrl: 'http://api.cloudflare.test',
                },
            }),
        ).toThrow('HTTPS API endpoint');
    });
});
