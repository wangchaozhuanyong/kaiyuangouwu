import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { NormalizeStorefrontExchangeRate1787770800000 } from './1787770800000-normalize-storefront-exchange-rate';

describe('storefront exchange-rate schema normalization', () => {
    it.each([
        ['mysql', 'double'],
        ['postgres', 'double precision'],
        ['sqlite', 'float'],
    ] as const)('removes the database default on %s', async (databaseType, expectedType) => {
        const channel = new Table({
            name: 'channel',
            columns: [
                {
                    name: 'customFieldsCnytomyrrate',
                    type: expectedType,
                    isNullable: false,
                    default: 0.6,
                },
            ],
        });
        const changeColumn = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: databaseType } },
            getTable: vi.fn().mockResolvedValue(channel),
            changeColumn,
        } as unknown as QueryRunner;

        await new NormalizeStorefrontExchangeRate1787770800000().up(queryRunner);

        const next = changeColumn.mock.calls[0][2];
        expect(next.type).toBe(expectedType);
        expect(next.isNullable).toBe(true);
        expect(next.default).toBeUndefined();
    });
});
