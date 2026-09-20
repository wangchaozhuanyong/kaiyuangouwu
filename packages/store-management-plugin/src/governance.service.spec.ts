import type { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { GovernanceApprovalRequest } from './entities/governance-approval-request.entity';
import { GovernanceAuditEntry } from './entities/governance-audit-entry.entity';
import { GovernedConfigVersion } from './entities/governed-config-version.entity';
import {
    derivedIdempotencyKey,
    GovernanceService,
    parseAndValidateConfig,
    stableJson,
} from './governance.service';

const ctx = { channelId: 'channel-1', activeUserId: 'admin-1' } as unknown as RequestContext;

describe('governance control plane', () => {
    it('normalizes approved rule schemas and rejects unknown configuration keys', () => {
        expect(
            parseAndValidateConfig('FRAUD_RULES', JSON.stringify({ reviewScore: 45, holdScore: 70 })),
        ).toEqual({
            enabled: true,
            highValueThreshold: 100_000,
            velocityOrderCount: 3,
            failedPaymentCount: 2,
            reviewScore: 45,
            holdScore: 70,
        });
        expect(() =>
            parseAndValidateConfig('REPORT_SCHEDULE', JSON.stringify({ hourUtc: 3, secret: 'nope' })),
        ).toThrow('不支持字段');
        expect(() =>
            parseAndValidateConfig('FRAUD_RULES', JSON.stringify({ reviewScore: 70, holdScore: 40 })),
        ).toThrow('拦截阈值不能低于人工复核阈值');
        expect(stableJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
        expect(derivedIdempotencyKey('governance-review', 'x'.repeat(96))).toMatch(
            /^governance-review:[0-9a-f]{64}$/u,
        );
        expect(derivedIdempotencyKey('governance-review', 'x'.repeat(96))).toHaveLength(82);
    });

    it('enforces four-eyes approval', async () => {
        const config = Object.assign(new GovernedConfigVersion(), {
            id: 'config-1',
            namespace: 'FRAUD_RULES',
            version: 1,
            status: 'DRAFT',
            payloadHash: 'hash',
        });
        const approval = Object.assign(new GovernanceApprovalRequest(), {
            id: 'approval-1',
            channelId: 'channel-1',
            status: 'PENDING',
            requestedByUserId: 'admin-1',
            expiresAt: new Date(Date.now() + 60_000),
            configVersion: config,
        });
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === GovernanceApprovalRequest)
                    return { findOne: vi.fn().mockResolvedValue(approval) };
                throw new Error('Unexpected repository');
            }),
        };
        const service = new GovernanceService(connection as never, {} as never, {} as never);

        await expect(
            service.reviewApproval(ctx, {
                id: approval.id,
                decision: 'APPROVE',
                reason: '同一操作人不能自审',
                idempotencyKey: 'approval:self:001',
            }),
        ).rejects.toThrow('提交人与审核人必须是不同管理员');
    });

    it('persists an expired approval instead of rolling back the terminal state', async () => {
        const config = Object.assign(new GovernedConfigVersion(), {
            id: 'config-expired-at-review',
            namespace: 'FRAUD_RULES',
            version: 3,
            status: 'DRAFT' as const,
        });
        const approval = Object.assign(new GovernanceApprovalRequest(), {
            id: 'approval-expired-at-review',
            channelId: 'channel-1',
            status: 'PENDING' as const,
            requestedByUserId: 'admin-2',
            expiresAt: new Date('2026-09-20T00:00:00.000Z'),
            configVersion: config,
        });
        const approvalRepository = {
            findOne: vi.fn().mockResolvedValue(approval),
            save: vi.fn().mockResolvedValue(approval),
        };
        const configRepository = { save: vi.fn().mockResolvedValue(config) };
        const auditEntries: GovernanceAuditEntry[] = [];
        const auditRepository = {
            findOneBy: vi.fn().mockResolvedValue(null),
            findOne: vi.fn().mockResolvedValue(null),
            save: vi.fn((entry: GovernanceAuditEntry) => {
                entry.id = 'audit-expired-at-review';
                auditEntries.push(entry);
                return Promise.resolve(entry);
            }),
        };
        const service = new GovernanceService(
            {
                getRepository: vi.fn((_ctx, entity) => {
                    if (entity === GovernanceApprovalRequest) return approvalRepository;
                    if (entity === GovernedConfigVersion) return configRepository;
                    if (entity === GovernanceAuditEntry) return auditRepository;
                    throw new Error('Unexpected repository');
                }),
            } as never,
            {} as never,
            {} as never,
        );

        await expect(
            service.reviewApproval(ctx, {
                id: approval.id,
                decision: 'APPROVE',
                reason: '审核时已超过有效期',
                idempotencyKey: 'approval:expired:001',
            }),
        ).resolves.toBe(approval);
        expect(approval.status).toBe('EXPIRED');
        expect(config.status).toBe('REJECTED');
        expect(configRepository.save).toHaveBeenCalledWith(config, { reload: false });
        expect(approvalRepository.save).toHaveBeenCalledWith(approval, { reload: false });
        expect(auditEntries[0]).toMatchObject({ eventType: 'CONFIG_APPROVAL_EXPIRED' });
    });

    it('creates and verifies an idempotent append-only hash chain', async () => {
        const entries: GovernanceAuditEntry[] = [];
        const repository = {
            findOneBy: vi.fn(({ idempotencyKey }) =>
                Promise.resolve(entries.find(item => item.idempotencyKey === idempotencyKey) ?? null),
            ),
            findOne: vi.fn(() => Promise.resolve(entries.at(-1) ?? null)),
            find: vi.fn(() => Promise.resolve([...entries].sort((a, b) => a.sequence - b.sequence))),
            save: vi.fn((entry: GovernanceAuditEntry) => {
                entry.id = String(entries.length + 1);
                entries.push(entry);
                return Promise.resolve(entry);
            }),
        };
        const service = new GovernanceService(
            {
                getRepository: vi.fn((_ctx, entity) => (entity === GovernanceAuditEntry ? repository : null)),
            } as never,
            {} as never,
            {} as never,
        );
        const input = {
            eventType: 'TEST_EVENT',
            resourceType: 'Test',
            resourceId: 'one',
            actorType: 'SYSTEM' as const,
            actorLabel: 'Test runner',
            reason: 'Verify hash chain',
            payload: { ok: true },
            idempotencyKey: 'audit:test:001',
        };
        await service.appendAudit(ctx, input);
        await service.appendAudit(ctx, input);
        await service.appendAudit(ctx, { ...input, resourceId: 'two', idempotencyKey: 'audit:test:002' });

        expect(entries).toHaveLength(2);
        await expect(service.verifyAuditChain(ctx)).resolves.toEqual({
            valid: true,
            checkedEntries: 2,
            brokenAt: null,
        });
        entries[0].reason = 'tampered';
        await expect(service.verifyAuditChain(ctx)).resolves.toMatchObject({ valid: false, brokenAt: 1 });
    });

    it('expires stale approvals and rejects their draft versions on the hourly sweep', async () => {
        const config = Object.assign(new GovernedConfigVersion(), {
            id: 'config-expired',
            namespace: 'FRAUD_RULES',
            version: 2,
            status: 'DRAFT' as const,
        });
        const approval = Object.assign(new GovernanceApprovalRequest(), {
            id: 'approval-expired',
            channelId: 'channel-1',
            status: 'PENDING' as const,
            expiresAt: new Date('2026-09-20T00:00:00.000Z'),
            configVersion: config,
        });
        const approvals = {
            createQueryBuilder: vi.fn(() => ({
                leftJoinAndSelect: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                take: vi.fn().mockReturnThis(),
                getMany: vi.fn().mockResolvedValue([approval]),
            })),
            save: vi.fn().mockResolvedValue(approval),
        };
        const configs = { save: vi.fn().mockResolvedValue(config) };
        const auditEntries: GovernanceAuditEntry[] = [];
        const audit = {
            findOneBy: vi.fn().mockResolvedValue(null),
            findOne: vi.fn().mockResolvedValue(null),
            save: vi.fn((entry: GovernanceAuditEntry) => {
                entry.id = 'audit-expired';
                auditEntries.push(entry);
                return Promise.resolve(entry);
            }),
        };
        const service = new GovernanceService(
            {
                getRepository: vi.fn((_ctx, entity) => {
                    if (entity === GovernanceApprovalRequest) return approvals;
                    if (entity === GovernedConfigVersion) return configs;
                    if (entity === GovernanceAuditEntry) return audit;
                    throw new Error('Unexpected repository');
                }),
            } as never,
            {} as never,
            {} as never,
        );

        await expect(
            (
                service as unknown as {
                    expireDueApprovals: (requestContext: RequestContext, now: Date) => Promise<number>;
                }
            ).expireDueApprovals(ctx, new Date('2026-09-21T00:00:00.000Z')),
        ).resolves.toBe(1);
        expect(approval.status).toBe('EXPIRED');
        expect(config.status).toBe('REJECTED');
        expect(auditEntries[0]).toMatchObject({ eventType: 'CONFIG_APPROVAL_EXPIRED' });
    });
});
