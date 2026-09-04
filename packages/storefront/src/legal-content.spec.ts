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
});

describe('interpolateLegalProfileTokens', () => {
    const identity = {
        legalEntityName: 'MOYAO AI Example Limited',
        legalRegistrationCountry: 'Malaysia',
        supportEmail: 'support@moyaoai.com',
        privacyEmail: 'privacy@moyaoai.com',
    };

    it('replaces every supported legal profile token with managed store data', () => {
        expect(
            interpolateLegalProfileTokens(
                '{{legalEntityName}} / {{ legalRegistrationCountry }} / {{supportEmail}} / {{privacyEmail}}',
                identity,
                'en',
            ),
        ).toBe('MOYAO AI Example Limited / Malaysia / support@moyaoai.com / privacy@moyaoai.com');
    });

    it('does not expose unresolved supported tokens', () => {
        expect(interpolateLegalProfileTokens('Controller: {{legalEntityName}}', undefined, 'en')).toBe(
            'Controller: Not configured',
        );
    });
});
