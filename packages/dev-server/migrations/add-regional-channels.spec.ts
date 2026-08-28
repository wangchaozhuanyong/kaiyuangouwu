import { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddRegionalChannels1786514500000 } from './1786514500000-add-regional-channels';
import { LocalizeAndAssignShippingMethods1786514683000 } from './1786514683000-localize-and-assign-shipping-methods';
import { SeedRegionalChannelCatalog1786514968000 } from './1786514968000-seed-regional-channel-catalog';
import { AddMainlandChineseCatalogContent1786515300000 } from './1786515300000-add-mainland-chinese-catalog-content';
import { LocalizeOperationalData1786515600000 } from './1786515600000-localize-operational-data';
import { RepairRegionalChannels1786760401000 } from './1786760401000-repair-regional-channels';
import { CompleteBilingualServiceCatalog1787612400000 } from './1787612400000-complete-bilingual-service-catalog';

describe('AddRegionalChannels migration', () => {
    it('uses PostgreSQL placeholders and quoted camel-case columns', async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce([
                {
                    track_inventory: true,
                    out_of_stock_threshold: 0,
                    prices_include_tax: false,
                    seller_id: 1,
                },
            ])
            .mockResolvedValueOnce([{ id: 1 }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(undefined);
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            hasTable: vi.fn().mockResolvedValue(true),
            query,
        } as unknown as QueryRunner;

        await new AddRegionalChannels1786514500000().up(queryRunner);

        const sourceSql = String(query.mock.calls[0]?.[0]);
        const insertSql = String(query.mock.calls[3]?.[0]);
        expect(sourceSql).toContain('"trackInventory"');
        expect(sourceSql).toContain('$1');
        expect(insertSql).toContain('INSERT INTO "channel"');
        expect(insertSql).toContain('"availableLanguageCodes"');
        expect(insertSql).toContain('$15');
        expect(query).toHaveBeenCalledTimes(6);
    });

    it('does nothing before the base channel and zone tables exist', async () => {
        const query = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'sqlite' } },
            hasTable: vi.fn().mockResolvedValue(false),
            query,
        } as unknown as QueryRunner;

        await new AddRegionalChannels1786514500000().up(queryRunner);

        expect(query).not.toHaveBeenCalled();
    });
});

describe('regional channel follow-up migrations', () => {
    it('uses portable duplicate protection for shipping assignments', async () => {
        const query = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            query,
        } as unknown as QueryRunner;

        await new LocalizeAndAssignShippingMethods1786514683000().up(queryRunner);

        const assignmentSql = String(query.mock.calls[0]?.[0]);
        expect(assignmentSql).toContain('INSERT INTO "shipping_method_channels_channel"');
        expect(assignmentSql).toContain('NOT EXISTS');
        expect(assignmentSql).not.toContain('INSERT OR IGNORE');
    });

    it('uses PostgreSQL placeholders when copying regional prices', async () => {
        const query = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            query,
        } as unknown as QueryRunner;

        await new SeedRegionalChannelCatalog1786514968000().up(queryRunner);

        const priceSql = String(query.mock.calls.at(-1)?.[0]);
        expect(priceSql).toContain('$1');
        expect(priceSql).toContain('$2');
        expect(priceSql).toContain('$3');
        expect(priceSql).toContain('source."currencyCode"');
        expect(query).toHaveBeenCalledTimes(14);
    });

    it('uses PostgreSQL-safe catalog translation statements', async () => {
        const query = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            query,
        } as unknown as QueryRunner;

        await new AddMainlandChineseCatalogContent1786515300000().up(queryRunner);

        const statements = query.mock.calls.map(call => String(call[0]));
        expect(statements).not.toContain(expect.stringContaining('?'));
        expect(statements[0]).toContain('$1');
        expect(statements[0]).toContain('source."baseId" = $3');
        expect(statements.at(-1)).toContain('source."baseId" = $2');
        expect(query.mock.calls.at(-1)?.[1]).toHaveLength(2);
    });

    it('uses PostgreSQL-safe operational localization statements', async () => {
        const query = vi.fn().mockImplementation((sql: string) =>
            Promise.resolve(sql.includes('SELECT "code" FROM "region"') ? [] : undefined),
        );
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            query,
        } as unknown as QueryRunner;

        await new LocalizeOperationalData1786515600000().up(queryRunner);

        const statements = query.mock.calls.map(call => String(call[0]));
        expect(statements).not.toContain(expect.stringContaining('?'));
        expect(statements[0]).toContain('$1');
        expect(statements[0]).toContain('$2');
        expect(statements.join('\n')).toContain('"payment_method"');
    });

    it('uses PostgreSQL-safe regional repair statements', async () => {
        const query = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            query,
        } as unknown as QueryRunner;

        await new RepairRegionalChannels1786760401000().up(queryRunner);

        const statements = query.mock.calls.map(call => String(call[0]));
        expect(statements).not.toContain(expect.stringContaining('?'));
        expect(statements[0]).toContain('$8');
        expect(statements.at(-1)).toContain('$3');
    });

    it('uses PostgreSQL-safe bilingual catalog lookup statements', async () => {
        const query = vi.fn().mockResolvedValue([]);
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            hasTable: vi.fn().mockResolvedValue(true),
            query,
        } as unknown as QueryRunner;

        await new CompleteBilingualServiceCatalog1787612400000().up(queryRunner);

        const statements = query.mock.calls.map(call => String(call[0]));
        expect(statements).not.toContain(expect.stringContaining('?'));
        expect(statements[0]).toContain('$1');
    });
});
