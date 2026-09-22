import { Customer } from '@vendure/core';
import { StorefrontContentBlock } from '@vendure/storefront-content-plugin';
import { describe, expect, it, vi } from 'vitest';

import { DataConsentService } from './data-consent.service';
import { DataConsentRecord } from './entities/data-consent-record.entity';

const ctx = {
    channelId: 'channel-1',
    activeUserId: null,
    req: { ip: '203.0.113.10', headers: { 'user-agent': 'Consent browser' }, secure: true },
} as never;

function createHarness() {
    const customer = Object.assign(new Customer(), { id: 'customer-1' });
    const legal = Object.assign(new StorefrontContentBlock(), {
        id: 'legal-1',
        channelId: 'channel-1',
        code: 'legal',
        type: 'LEGAL',
        enabled: true,
        position: 1,
        startsAt: null,
        endsAt: null,
        updatedAt: new Date('2026-09-20T00:00:00.000Z'),
        translations: [
            {
                languageCode: 'zh',
                title: '法律政策',
                subtitle: '',
                body: '本店条款与隐私政策',
                ctaLabel: '',
            },
        ],
        items: [
            {
                id: 'terms-item',
                enabled: true,
                targetValue: '#/legal?id=terms',
                updatedAt: new Date('2026-09-20T00:00:00.000Z'),
                translations: [{ languageCode: 'zh_Hans', label: '使用条款', description: '条款正文' }],
            },
            {
                id: 'privacy-item',
                enabled: true,
                targetValue: '#/legal?id=privacy',
                updatedAt: new Date('2026-09-20T00:00:00.000Z'),
                translations: [{ languageCode: 'zh_Hans', label: '隐私政策', description: '隐私正文' }],
            },
        ],
    });
    const query = {
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(customer),
    };
    const customerRepository = { createQueryBuilder: vi.fn(() => query) };
    const contentRepository = { find: vi.fn().mockResolvedValue([legal]) };
    const consentRepository = {
        count: vi.fn().mockResolvedValue(0),
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn((input: DataConsentRecord | DataConsentRecord[]) => {
            const rows = Array.isArray(input) ? input : [input];
            rows.forEach((row, index) => {
                row.id ??= `consent-${index + 1}`;
                row.createdAt ??= new Date();
                row.updatedAt ??= new Date();
            });
            return input;
        }),
        find: vi.fn().mockResolvedValue([]),
    };
    const connection = {
        getRepository: vi.fn((_ctx, target) => {
            if (target === Customer) return customerRepository;
            if (target === StorefrontContentBlock) return contentRepository;
            if (target === DataConsentRecord) return consentRepository;
            throw new Error(`Unexpected repository ${String(target)}`);
        }),
    };
    return {
        consentRepository,
        contentRepository,
        service: new DataConsentService(
            connection as never,
            {
                signingSecret: 'test-signing-secret',
            } as never,
        ),
    };
}

describe('DataConsentService', () => {
    it('requires explicit registration consent', async () => {
        const { service } = createHarness();
        await expect(
            service.assertRegistrationConsent(ctx, {
                termsAccepted: true,
                privacyAcknowledged: false,
                locale: 'zh',
            }),
        ).rejects.toThrow('注册前必须阅读并明确同意');
    });

    it('rejects legal content that is not active yet', async () => {
        const { service, contentRepository } = createHarness();
        const future = Object.assign(new StorefrontContentBlock(), {
            code: 'terms',
            enabled: true,
            startsAt: new Date('2999-01-01T00:00:00.000Z'),
            endsAt: null,
            items: [],
        });
        contentRepository.find.mockResolvedValue([future]);
        await expect(
            service.assertRegistrationConsent(ctx, {
                termsAccepted: true,
                privacyAcknowledged: true,
                locale: 'zh',
            }),
        ).rejects.toThrow('使用条款尚未配置');
    });

    it('snapshots policy versions and appends separate terms and privacy evidence', async () => {
        const { service, consentRepository } = createHarness();
        const snapshots = await service.assertRegistrationConsent(ctx, {
            termsAccepted: true,
            privacyAcknowledged: true,
            locale: 'zh',
        });
        expect(snapshots.terms.version).toMatch(/^terms-2026-09-20/u);
        expect(snapshots.privacy.digest).toHaveLength(64);

        await service.recordRegistrationByEmail(ctx, 'customer@example.com', 'REGISTRATION', snapshots);
        const records = consentRepository.save.mock.calls[0][0] as DataConsentRecord[];
        expect(records.map(record => record.purpose)).toEqual(['TERMS', 'PRIVACY']);
        expect(records.every(record => record.action === 'GRANTED')).toBe(true);
        expect(records[0].ipHash).toHaveLength(64);
        expect(records[0].ipHash).not.toContain('203.0.113.10');
    });

    it('records analytics withdrawal without creating an analytics identifier from network data', async () => {
        const { service, consentRepository } = createHarness();
        const record = await service.recordAnalyticsConsent(ctx, {
            consentId: '00000000-0000-4000-8000-000000000123',
            granted: false,
            locale: 'en',
        });
        expect(record).toMatchObject({
            purpose: 'ANALYTICS',
            action: 'WITHDRAWN',
            customerId: null,
            policyVersion: 'storefront-analytics-v1',
        });
        expect(record.subjectKeyHash).toHaveLength(64);
        expect(consentRepository.count).toHaveBeenCalledOnce();
    });

    it('does not append duplicate analytics choices and limits distinct public writes', async () => {
        const { service, consentRepository } = createHarness();
        consentRepository.findOne.mockResolvedValueOnce(
            Object.assign(new DataConsentRecord(), {
                id: 'existing-consent',
                action: 'GRANTED',
                policyVersion: 'storefront-analytics-v1',
            }),
        );
        const existing = await service.recordAnalyticsConsent(ctx, {
            consentId: '00000000-0000-4000-8000-000000000123',
            granted: true,
            locale: 'en',
        });
        expect(existing.id).toBe('existing-consent');
        expect(consentRepository.save).not.toHaveBeenCalled();

        consentRepository.findOne.mockResolvedValueOnce(null);
        consentRepository.count.mockResolvedValueOnce(10);
        await expect(
            service.recordAnalyticsConsent(ctx, {
                consentId: '00000000-0000-4000-8000-000000000124',
                granted: false,
                locale: 'en',
            }),
        ).rejects.toThrow('更新过于频繁');
    });
});
