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
    it('claims a pending request before applying approved values', async () => {
        const request = {
            id: 'request-1',
            channelId: 'store-1',
            requestType: 'LEGAL_IDENTITY',
            status: 'PENDING',
        };
        const execute = vi.fn().mockResolvedValue({ affected: 1 });
        const builder = {
            update: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            execute,
        };
        const repository = {
            findOne: vi.fn().mockResolvedValue(request),
            createQueryBuilder: vi.fn().mockReturnValue(builder),
        };
        const audit = { record: vi.fn().mockResolvedValue(undefined) };
        const service = new StoreGovernanceService(
            { getRepository: vi.fn().mockReturnValue(repository) } as any,
            { current: vi.fn().mockResolvedValue({ scope: 'PLATFORM', userId: 'reviewer-1' }) } as any,
            audit as any,
            { signingSecret: 'governance-test-secret' } as any,
        );
        const apply = vi.spyOn(service as any, 'applyApprovedChange').mockResolvedValue(undefined);

        await expect(
            service.review({} as any, { id: 'request-1', decision: 'APPROVED' }),
        ).resolves.toMatchObject({ status: 'APPROVED', reviewedByUserId: 'reviewer-1' });
        expect(builder.where).toHaveBeenCalledWith('id = :id AND status = :status', {
            id: 'request-1',
            status: 'PENDING',
        });
        expect(execute).toHaveBeenCalledBefore(apply);
        expect(audit.record).toHaveBeenCalledOnce();
    });

    it('rejects a concurrent review when the pending row was already claimed', async () => {
        const builder = {
            update: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue({ affected: 0 }),
        };
        const repository = {
            findOne: vi.fn().mockResolvedValue({ id: 'request-1', status: 'PENDING' }),
            createQueryBuilder: vi.fn().mockReturnValue(builder),
        };
        const audit = { record: vi.fn() };
        const service = new StoreGovernanceService(
            { getRepository: vi.fn().mockReturnValue(repository) } as any,
            { current: vi.fn().mockResolvedValue({ scope: 'PLATFORM', userId: 'reviewer-1' }) } as any,
            audit as any,
            { signingSecret: 'governance-test-secret' } as any,
        );
        const apply = vi.spyOn(service as any, 'applyApprovedChange').mockResolvedValue(undefined);

        await expect(service.review({} as any, { id: 'request-1', decision: 'APPROVED' })).rejects.toThrow(
            '该申请已经完成审核',
        );
        expect(apply).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
    });

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
