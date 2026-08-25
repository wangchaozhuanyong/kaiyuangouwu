const path = require('node:path');

const runtimeDirectory = process.env.VENDURE_RUNTIME_DIR;

if (
    !runtimeDirectory ||
    !path.isAbsolute(runtimeDirectory) ||
    runtimeDirectory === path.parse(runtimeDirectory).root
) {
    throw new Error('VENDURE_RUNTIME_DIR must be an absolute candidate runtime directory');
}

const sharedEnvironment = {
    NODE_ENV: 'production',
    RUN_JOB_QUEUE: '0',
    RUN_MIGRATIONS: 'false',
    // Vendure's telemetry fallback writes .vendure/.installation-id below cwd,
    // which would mutate the verified immutable runtime directory.
    VENDURE_DISABLE_TELEMETRY: 'true',
};

module.exports = {
    apps: [
        {
            name: 'vendure-worker',
            cwd: runtimeDirectory,
            script: 'packages/dev-server/dist/index-worker.js',
            interpreter: process.execPath,
            env: sharedEnvironment,
        },
        {
            name: 'vendure-api',
            cwd: runtimeDirectory,
            script: 'packages/dev-server/dist/index.js',
            interpreter: process.execPath,
            env: sharedEnvironment,
        },
    ],
};
