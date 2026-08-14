import { bootstrap, JobQueueService, runMigrations } from '@vendure/core';

import { devConfig } from './dev-config';

/**
 * This bootstraps the dev server, used for testing Vendure during development.
 */
const prepareDatabase = process.env.RUN_MIGRATIONS === 'false' ? Promise.resolve() : runMigrations(devConfig);

prepareDatabase
    .then(() => bootstrap(devConfig))
    .then(app => {
        if (process.env.RUN_JOB_QUEUE === '1') {
            return app.get(JobQueueService).start();
        }
    })
    .catch(err => {
        // eslint-disable-next-line
        console.log(err);
        process.exit(1);
    });
