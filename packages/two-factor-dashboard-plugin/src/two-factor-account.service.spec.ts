import { FindOperator } from 'typeorm';
import { beforeEach, describe, expect, it } from 'vitest';

import { DashboardTwoFactorAccount } from './entities/dashboard-two-factor-account.entity';
import { TwoFactorAccountService } from './two-factor-account.service';
import { TwoFactorCipherService } from './two-factor-cipher.service';

describe('TwoFactorAccountService', () => {
    beforeEach(() => {
        process.env.NODE_ENV = 'test';
        process.env.TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY =
            'dashboard-two-factor-service-test-key-with-more-than-32-characters';
    });

    it('persists encrypted accounts and isolates them by administrator', async () => {
        const fixture = createFixture();
        const first = await fixture.service.create(fixture.context('user-1'), {
            projectName: '客服账号 01',
            secret: 'JBSWY3DPEHPK3PXP',
        });

        expect(first.secret).toBe('JBSWY3DPEHPK3PXP');
        expect(fixture.rows[0].encryptedSecret).not.toContain('JBSWY3DPEHPK3PXP');
        expect(await fixture.service.findAll(fixture.context('user-1'))).toHaveLength(1);
        expect(await fixture.service.findAll(fixture.context('user-2'))).toEqual([]);
    });

    it('updates usage timestamps and rejects duplicate secrets for one administrator', async () => {
        const fixture = createFixture();
        const first = await fixture.service.create(fixture.context('user-1'), {
            projectName: '账号一',
            secret: 'JBSWY3DPEHPK3PXP',
        });
        await fixture.service.create(fixture.context('user-1'), {
            projectName: '账号二',
            secret: 'GEZDGNBVGY3TQOJQ',
        });

        await expect(
            fixture.service.update(fixture.context('user-1'), {
                id: first.id,
                projectName: '账号一',
                secret: 'GEZDGNBVGY3TQOJQ',
            }),
        ).rejects.toThrow('已经存在');

        const touched = await fixture.service.touch(fixture.context('user-1'), first.id);
        expect(touched.lastUsedAt).toBeInstanceOf(Date);
    });

    it('imports and clears only the active administrator records', async () => {
        const fixture = createFixture();
        await fixture.service.create(fixture.context('user-2'), {
            projectName: '另一管理员账号',
            secret: 'MFRGGZDFMZTWQ2LK',
        });
        const imported = await fixture.service.import(fixture.context('user-1'), [
            { projectName: '账号一', secret: 'JBSWY3DPEHPK3PXP' },
            { projectName: '账号二', secret: 'GEZDGNBVGY3TQOJQ' },
        ]);

        expect(imported).toHaveLength(2);
        await fixture.service.clear(fixture.context('user-1'));
        expect(await fixture.service.findAll(fixture.context('user-1'))).toEqual([]);
        expect(await fixture.service.findAll(fixture.context('user-2'))).toHaveLength(1);
    });
});

function createFixture() {
    const rows: DashboardTwoFactorAccount[] = [];
    let nextId = 1;
    const repository = {
        find: ({ where }: any) =>
            Promise.resolve(
                rows
                    .filter(row => matches(row, where))
                    .sort((left, right) => Number(left.id) - Number(right.id)),
            ),
        findOne: ({ where }: any) => Promise.resolve(rows.find(row => matches(row, where)) ?? null),
        count: ({ where }: any) => Promise.resolve(rows.filter(row => matches(row, where)).length),
        save: (value: DashboardTwoFactorAccount | DashboardTwoFactorAccount[]) => {
            const values = Array.isArray(value) ? value : [value];
            for (const account of values) {
                if (!account.id) {
                    account.id = nextId++;
                    account.createdAt = new Date();
                }
                account.updatedAt = new Date();
                const index = rows.findIndex(row => String(row.id) === String(account.id));
                if (index >= 0) rows[index] = account;
                else rows.push(account);
            }
            return Promise.resolve(Array.isArray(value) ? values : values[0]);
        },
        delete: (where: any) => {
            const before = rows.length;
            for (let index = rows.length - 1; index >= 0; index -= 1) {
                if (matches(rows[index], where)) rows.splice(index, 1);
            }
            return Promise.resolve({ affected: before - rows.length });
        },
    };
    const connection = { getRepository: () => repository };
    const administratorService = {
        findOneByUserId: (_ctx: unknown, userId: string) =>
            Promise.resolve({
                id: userId === 'user-1' ? 'administrator-1' : 'administrator-2',
            }),
    };
    const service = new TwoFactorAccountService(
        connection as any,
        administratorService as any,
        new TwoFactorCipherService(),
    );
    return {
        rows,
        service,
        context: (activeUserId: string) => ({ activeUserId }) as any,
    };
}

function matches(row: DashboardTwoFactorAccount, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, condition]) => {
        const value = (row as any)[key];
        if (condition instanceof FindOperator) {
            if (condition.type === 'in') return (condition.value as unknown[]).includes(value);
            if (condition.type === 'not') return value !== condition.value;
        }
        return String(value) === String(condition);
    });
}
