import { describe, expect, it, vi } from 'vitest';

import { StoreGovernanceService } from './store-governance.service';

function createService(scope: 'PLATFORM' | 'STORE' = 'PLATFORM') {
    const accessService = {
        current: vi.fn().mockResolvedValue({ scope, authority: 'STAFF' }),
    };
    const service = new StoreGovernanceService(
        {} as any,
        accessService as any,
        {} as any,
        { signingSecret: 'governance-test-secret' } as any,
    );
    return { accessService, service };
}

describe('StoreGovernanceService', () => {
    it('accepts legal identity and payout account payloads but routes payment and USDT to dedicated flows', () => {
        const { service } = createService();
        const validate = (service as any).validatePayload.bind(service);

        expect(() =>
            validate('LEGAL_IDENTITY', {
                legalEntityName: '模钥科技有限公司',
                legalRegistrationCountry: 'MY',
            }),
        ).not.toThrow();
        expect(() =>
            validate('PAYOUT_ACCOUNT', {
                provider: 'Example Bank',
                accountHolder: '模钥科技有限公司',
                accountIdentifier: '1234567890',
            }),
        ).not.toThrow();
        expect(() => validate('PAYMENT_CONFIGURATION', {})).toThrow('专用启停流程');
        expect(() => validate('USDT_WALLET', {})).toThrow('专用的钱包提交审核流程');
        expect(() =>
            validate('PAYOUT_ACCOUNT', {
                provider: 'Example Bank',
                accountHolder: '商户',
                accountIdentifier: '1234567890',
                secretParameters: { token: 'should-not-be-stored' },
            }),
        ).toThrow('不支持的字段');
        expect(() =>
            validate('PAYOUT_ACCOUNT', {
                provider: 'Example Bank',
                accountHolder: '商户',
                accountIdentifier: '1'.repeat(201),
            }),
        ).toThrow('收款账号不能超过 200 个字符');
        expect(
            validate('PAYOUT_ACCOUNT', {
                provider: '  Example Bank  ',
                accountHolder: '  商户  ',
                accountIdentifier: '  1234567890  ',
            }),
        ).toEqual({
            provider: 'Example Bank',
            accountHolder: '商户',
            accountIdentifier: '1234567890',
        });
    });

    it('reveals encrypted review content only to platform-scoped reviewers', async () => {
        const platform = createService('PLATFORM');
        const encryptedPayload = (platform.service as any).encrypt({ accountIdentifier: '1234567890' });
        await expect(platform.service.reviewPayload({} as any, { encryptedPayload } as any)).resolves.toEqual(
            { accountIdentifier: '1234567890' },
        );

        const store = createService('STORE');
        await expect(store.service.reviewPayload({} as any, { encryptedPayload } as any)).rejects.toThrow();
    });
});
