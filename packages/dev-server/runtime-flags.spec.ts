import { describe, expect, it } from 'vitest';

import { shouldRunMigrations } from './runtime-flags';

describe('shouldRunMigrations', () => {
    it('requires an explicit opt-in in production', () => {
        expect(shouldRunMigrations({ NODE_ENV: 'production', RUN_MIGRATIONS: undefined })).toBe(false);
        expect(shouldRunMigrations({ NODE_ENV: 'production', RUN_MIGRATIONS: 'false' })).toBe(false);
        expect(shouldRunMigrations({ NODE_ENV: 'production', RUN_MIGRATIONS: 'true' })).toBe(true);
    });

    it('keeps development migrations enabled unless explicitly disabled', () => {
        expect(shouldRunMigrations({ NODE_ENV: 'development', RUN_MIGRATIONS: undefined })).toBe(true);
        expect(shouldRunMigrations({ NODE_ENV: 'development', RUN_MIGRATIONS: 'false' })).toBe(false);
    });
});
