import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignSqliteSchema1788182779979 } from './1788182779979-align-sqlite-schema';

describe('SQLite schema alignment migration', () => {
    it.each(['postgres', 'mysql', 'mariadb'] as const)('does not alter %s databases', async type => {
        const query = vi.fn();
        const queryRunner = {
            connection: { options: { type } },
            query,
        } as unknown as QueryRunner;
        const migration = new AlignSqliteSchema1788182779979();

        await migration.up(queryRunner);
        await migration.down(queryRunner);

        expect(query).not.toHaveBeenCalled();
    });
});
