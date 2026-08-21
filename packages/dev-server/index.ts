import { bootstrap, JobQueueService, runMigrations } from '@vendure/core';

import { devConfig } from './dev-config';
import { shouldRunMigrations } from './runtime-flags';

/**
 * This bootstraps the dev server, used for testing Vendure during development.
 */
const prepareDatabase = shouldRunMigrations() ? runMigrations(devConfig) : Promise.resolve();

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
