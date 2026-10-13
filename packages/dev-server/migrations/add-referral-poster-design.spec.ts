import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddReferralPosterDesign1791849600000 } from './1791849600000-add-referral-poster-design';

describe('AddReferralPosterDesign1791849600000', () => {
    it('preserves old records, roundtrips artwork, supports reentry and reverses only the new column', async () => {
        const source = await new DataSource({ type: 'sqljs', entities: [], synchronize: false }).initialize();
        const runner = source.createQueryRunner();
        try {
            await runner.query(
                'CREATE TABLE referral_poster_template (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
            );
            await runner.query('INSERT INTO referral_poster_template (id, name) VALUES (?, ?)', [
                1,
                'Existing',
            ]);
            const migration = new AddReferralPosterDesign1791849600000();
            await migration.up(runner);
            await migration.up(runner);
            expect(await runner.query('SELECT * FROM referral_poster_template')).toEqual([
                { id: 1, name: 'Existing', design: null },
            ]);
            const design = {
                version: 3,
                canvas: { width: 1080, height: 1920 },
                qr: { shape: 'circle', centerX: 540, centerY: 1488, diameter: 456, style: 'jade' },
            };
            await runner.query('UPDATE referral_poster_template SET design = ? WHERE id = ?', [
                JSON.stringify(design),
                1,
            ]);
            expect(
                JSON.parse((await runner.query('SELECT design FROM referral_poster_template'))[0].design),
            ).toEqual(design);
            await migration.down(runner);
            await migration.down(runner);
            expect(await runner.query('SELECT * FROM referral_poster_template')).toEqual([
                { id: 1, name: 'Existing' },
            ]);
        } finally {
            await runner.release();
            await source.destroy();
        }
    });

    it.each(['mysql', 'postgres', 'better-sqlite3'])(
        'adds nullable text for %s simple-json storage',
        async type => {
            const addColumn = vi.fn();
            const runner = {
                connection: { options: { type } },
                getTable: () => Promise.resolve(new Table({ name: 'referral_poster_template', columns: [] })),
                addColumn,
            } as unknown as QueryRunner;
            await new AddReferralPosterDesign1791849600000().up(runner);
            expect(addColumn).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ name: 'design', type: 'text', isNullable: true }),
            );
        },
    );

    it('is safe in environments without the optional poster table', async () => {
        const runner = {
            getTable: () => Promise.resolve(undefined),
            addColumn: vi.fn(),
            dropColumn: vi.fn(),
        };
        const migration = new AddReferralPosterDesign1791849600000();
        await migration.up(runner as unknown as QueryRunner);
        await migration.down(runner as unknown as QueryRunner);
        expect(runner.addColumn).not.toHaveBeenCalled();
        expect(runner.dropColumn).not.toHaveBeenCalled();
    });
});
