import { Customer } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    ACCOUNT_CLOSURE_COOLING_OFF_DAYS,
    dataSubjectHash,
    DataSubjectService,
} from './data-subject.service';
import { DataSubjectRequest } from './entities/data-subject-request.entity';

const ctx = { channelId: 'channel-1', activeUserId: 'user-1' } as never;

function createService() {
    const customer = Object.assign(new Customer(), {
        id: 'customer-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-20T00:00:00.000Z'),
        title: '',
        firstName: '测试',
        lastName: '用户',
        emailAddress: 'customer@example.com',
        phoneNumber: '123',
        addresses: [],
        channels: [{ id: 'channel-1' }],
    });
    const requests: DataSubjectRequest[] = [];
    const requestRepository = {
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn((request: DataSubjectRequest) => {
            request.id ??= `request-${requests.length + 1}`;
            request.createdAt ??= new Date();
            request.updatedAt ??= new Date();
            if (!requests.includes(request)) requests.push(request);
            return Promise.resolve(request);
        }),
    };
    const customerRepository = { findOne: vi.fn().mockResolvedValue(customer) };
    const emptyRepository = { find: vi.fn().mockResolvedValue([]) };
    const connection = {
        rawConnection: { options: { type: 'mysql' }, entityMetadatas: [] },
        getRepository: vi.fn((_ctx, target) => {
            if (target === DataSubjectRequest) return requestRepository;
            if (target === Customer) return customerRepository;
            return emptyRepository;
        }),
    };
    const authService = { verifyUserPassword: vi.fn().mockResolvedValue(true) };
    const customerService = { findOneByUserId: vi.fn().mockResolvedValue(customer) };
    return {
        authService,
        customer,
        requestRepository,
        requests,
        service: new DataSubjectService(
            connection as never,
            {} as never,
            authService as never,
            customerService as never,
            {} as never,
            {} as never,
        ),
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('DataSubjectService', () => {
    it('requires password verification and schedules account closure after seven days', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-20T00:00:00.000Z'));
        const test = createService();

        const request = await test.service.requestAccountClosure(ctx, 'correct password');

        expect(test.authService.verifyUserPassword).toHaveBeenCalledWith(ctx, 'user-1', 'correct password');
        expect(request).toMatchObject({
            channelId: 'channel-1',
            customerId: 'customer-1',
            subjectKeyHash: dataSubjectHash('customer-1'),
            requestType: 'ACCOUNT_CLOSURE',
            status: 'PENDING',
            attemptCount: 0,
        });
        expect(request.dueAt?.getTime()).toBe(
            Date.now() + ACCOUNT_CLOSURE_COOLING_OFF_DAYS * 24 * 60 * 60 * 1000,
        );
        expect(request.nextAttemptAt).toEqual(request.dueAt);
    });

    it('does not create a duplicate active closure request', async () => {
        const test = createService();
        const existing = Object.assign(new DataSubjectRequest(), {
            id: 'existing',
            status: 'BLOCKED' as const,
            requestType: 'ACCOUNT_CLOSURE' as const,
        });
        test.requestRepository.findOne.mockResolvedValue(existing);

        await expect(test.service.requestAccountClosure(ctx, 'password')).resolves.toBe(existing);
        expect(test.requestRepository.save).not.toHaveBeenCalled();
    });

    it('rejects sensitive requests when the current password is wrong', async () => {
        const test = createService();
        test.authService.verifyUserPassword.mockResolvedValue({ __typename: 'InvalidCredentialsError' });

        await expect(test.service.requestAccountClosure(ctx, 'wrong')).rejects.toThrow('当前账户密码不正确');
        await expect(test.service.exportMine(ctx, 'wrong')).rejects.toThrow('当前账户密码不正确');
        expect(test.requestRepository.save).not.toHaveBeenCalled();
    });

    it('exports account data without storing the export body in the audit record', async () => {
        const test = createService();

        const exported = await test.service.exportMine(ctx, 'password');
        const body = JSON.parse(exported.content) as {
            profile: { emailAddress: string };
            addresses: unknown[];
            orders: unknown[];
            imageStudio: { jobs: unknown[]; privateAssets: unknown[] };
            couponHistory: { ledger: unknown[]; allocations: unknown[] };
        };

        expect(body.profile.emailAddress).toBe('customer@example.com');
        expect(body.addresses).toEqual([]);
        expect(body.orders).toEqual([]);
        expect(body.imageStudio).toMatchObject({ jobs: [], privateAssets: [] });
        expect(body.couponHistory).toEqual({ ledger: [], allocations: [] });
        expect(exported.sha256).toHaveLength(64);
        expect(exported.request).toMatchObject({
            requestType: 'EXPORT',
            status: 'FULFILLED',
            resultDigest: exported.sha256,
        });
        expect(exported.request.resultSummaryJson).toContain('"orderCount":0');
        expect(exported.request.resultSummaryJson).not.toContain('customer@example.com');
        expect(exported.content).not.toContain('password');
    });

    it('cancels an active closure request but keeps its audit row', async () => {
        const test = createService();
        const request = Object.assign(new DataSubjectRequest(), {
            id: 'closure-1',
            status: 'PENDING' as const,
            requestType: 'ACCOUNT_CLOSURE' as const,
            nextAttemptAt: new Date(),
        });
        test.requestRepository.findOne.mockResolvedValue(request);

        await expect(test.service.cancelAccountClosure(ctx)).resolves.toBe(request);
        expect(request.status).toBe('CANCELLED');
        expect(request.nextAttemptAt).toBeNull();
        expect(request.cancelledAt).toBeInstanceOf(Date);
        expect(test.requestRepository.save).toHaveBeenCalledWith(request);
    });
});
