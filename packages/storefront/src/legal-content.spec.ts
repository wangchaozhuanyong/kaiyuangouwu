import { describe, expect, it } from 'vitest';

import { interpolateLegalProfileTokens, resolveManagedLegalDocument } from './legal-content';
import { StorefrontContentBlock } from './types';

function legalBlock(overrides: Partial<StorefrontContentBlock> = {}): StorefrontContentBlock {
    return {
        id: 'legal-1',
        code: 'legal',
        type: 'LEGAL',
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        title: 'Legal',
        subtitle: 'Store policies',
        body: 'General policy',
        ctaLabel: '',
        items: [],
        ...overrides,
    };
}

describe('resolveManagedLegalDocument', () => {
    it('resolves both documents from the new shared legal block targets', () => {
        const block = legalBlock({
            code: 'storefront-legal-test',
            body: '',
            items: [
                {
                    id: 'privacy',
                    enabled: true,
                    position: 0,
                    imageUrl: null,
                    targetType: 'PAGE',
                    targetValue: '/legal?id=privacy',
                    label: 'Privacy policy',
                    description: 'Privacy paragraph one.\nPrivacy paragraph two.',
                },
                {
                    id: 'terms',
                    enabled: true,
                    position: 1,
                    imageUrl: null,
                    targetType: 'PAGE',
                    targetValue: '/legal?id=terms',
                    label: 'Terms of use',
                    description: 'Terms paragraph.',
                },
            ],
        });

        expect(resolveManagedLegalDocument([block], 'privacy', 'Privacy')?.body).toBe(
            'Privacy paragraph one.\nPrivacy paragraph two.',
        );
        expect(resolveManagedLegalDocument([block], 'terms', 'Terms')?.body).toBe('Terms paragraph.');
    });

    it('uses the matching managed item for each legal route', () => {
        const block = legalBlock({
            items: [
                {
                    id: 'privacy',
                    enabled: true,
                    position: 0,
                    imageUrl: null,
                    targetType: 'PAGE',
                    targetValue: '#/legal?id=privacy',
                    label: 'Privacy notice',
                    description: 'Privacy policy body',
                },
            ],
        });

        expect(resolveManagedLegalDocument([block], 'privacy', 'Privacy')).toEqual({
            title: 'Privacy notice',
            subtitle: 'Store policies',
            body: 'Privacy policy body',
        });
    });

    it('returns null when the active store has no publishable legal body', () => {
        expect(resolveManagedLegalDocument([], 'terms', 'Terms')).toBeNull();
        expect(resolveManagedLegalDocument([legalBlock({ body: '' })], 'terms', 'Terms')).toBeNull();
    });

    it('does not reuse one legal document for a different legal route', () => {
        const privacy = legalBlock({ code: 'privacy', title: 'Privacy', body: 'Privacy only' });

        expect(resolveManagedLegalDocument([privacy], 'privacy', 'Privacy')).toMatchObject({
            body: 'Privacy only',
        });
        expect(resolveManagedLegalDocument([privacy], 'terms', 'Terms')).toBeNull();
    });

    it('requires an exact managed page target', () => {
        const block = legalBlock({
            items: [
                {
                    id: 'unrelated',
                    enabled: true,
                    position: 0,
                    imageUrl: null,
                    targetType: 'PAGE',
                    targetValue: '#/redirect?next=legal?id=privacy',
                    label: 'Unrelated',
                    description: 'Must not be used',
                },
            ],
            body: '',
        });

        expect(resolveManagedLegalDocument([block], 'privacy', 'Privacy')).toBeNull();
    });

    it('uses only the legal blocks supplied for the active channel', () => {
        const policy = legalBlock({ code: 'terms', body: 'This store policy.' });

        expect(resolveManagedLegalDocument([policy], 'terms', 'Terms')).toMatchObject({
            body: 'This store policy.',
        });
        expect(resolveManagedLegalDocument([], 'terms', 'Terms')).toBeNull();
    });

    it('hides a policy that declares a different storefront domain without a store-specific list', () => {
        const policy = legalBlock({
            code: 'privacy',
            body: '本隐私政策适用于您访问 damatong.net 及其对应店铺。',
        });

        expect(resolveManagedLegalDocument([policy], 'privacy', '隐私政策', 'moyaoai.com')).toBeNull();
        expect(
            resolveManagedLegalDocument([policy], 'privacy', '隐私政策', 'www.damatong.net'),
        ).toMatchObject({
            body: policy.body,
        });
    });

    it('keeps policy references to outside services when no other storefront scope is declared', () => {
        const policy = legalBlock({
            code: 'privacy',
            body: 'We may use payments.example.com as a service provider. This policy applies to shop.example.com.',
        });

        expect(resolveManagedLegalDocument([policy], 'privacy', 'Privacy', 'shop.example.com')).toMatchObject(
            {
                body: policy.body,
            },
        );
    });
});

describe('interpolateLegalProfileTokens', () => {
    const identity = {
        legalEntityName: 'MOYAO AI Example Limited',
        legalRegistrationCountry: 'Malaysia',
        legalRegistrationNumber: '123456789012 (123456-A)',
        legalContactAddress: '10 Example Road, 50000 Kuala Lumpur',
        supportEmail: 'support@moyaoai.com',
        privacyEmail: 'privacy@moyaoai.com',
    };

    it('replaces every supported legal profile token with managed store data', () => {
        expect(
            interpolateLegalProfileTokens(
                '{{legalEntityName}} / {{ legalRegistrationCountry }} / {{legalRegistrationNumber}} / {{legalContactAddress}} / {{supportEmail}} / {{privacyEmail}}',
                identity,
                'en',
            ),
        ).toBe(
            'MOYAO AI Example Limited / Malaysia / 123456789012 (123456-A) / 10 Example Road, 50000 Kuala Lumpur / support@moyaoai.com / privacy@moyaoai.com',
        );
    });

    it('does not expose unresolved supported tokens', () => {
        expect(interpolateLegalProfileTokens('Controller: {{legalEntityName}}', undefined, 'en')).toBe(
            'Controller: Not configured',
        );
    });
});
