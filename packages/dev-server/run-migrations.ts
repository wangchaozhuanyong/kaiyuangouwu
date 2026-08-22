import { runMigrations } from '@vendure/core';

import { devConfig } from './dev-config';

if (process.env.NODE_ENV !== 'production' || process.env.RUN_MIGRATIONS !== 'true') {
    throw new Error('Production migration runner requires NODE_ENV=production and RUN_MIGRATIONS=true');
}

runMigrations(devConfig)
    .then(migrations => {
        if (process.exitCode) {
            throw new Error('One or more production migrations failed');
        }
        // eslint-disable-next-line no-console
        console.log(`Production migrations complete (${migrations.length} applied)`);
    })
    .catch(error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    });
