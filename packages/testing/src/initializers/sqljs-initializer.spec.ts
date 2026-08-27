import fs from 'fs';
import os from 'os';
import path from 'path';
import { SqljsConnectionOptions } from 'typeorm/driver/sqljs/SqljsConnectionOptions';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SqljsInitializer } from './sqljs-initializer';

describe('SqljsInitializer', () => {
    const temporaryDirectories: string[] = [];

    afterEach(() => {
        vi.restoreAllMocks();
        for (const directory of temporaryDirectories.splice(0)) {
            fs.rmSync(directory, { force: true, recursive: true });
        }
    });

    it('tolerates another test worker creating the data directory first', async () => {
        const parentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-sqljs-'));
        const dataDirectory = path.join(parentDirectory, '__data__');
        temporaryDirectories.push(parentDirectory);
        fs.mkdirSync(dataDirectory);

        const connectionOptions = { type: 'sqljs' } as SqljsConnectionOptions;
        const initializer = new SqljsInitializer(dataDirectory);
        await initializer.init('race-condition.e2e-spec.ts', connectionOptions);

        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        const populate = vi.fn().mockResolvedValue(undefined);

        await expect(initializer.populate(populate)).resolves.toBeUndefined();
        expect(populate).toHaveBeenCalledOnce();
    });
});
