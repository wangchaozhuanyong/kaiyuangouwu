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
    // Keep the business-time guard deterministic regardless of the PM2 daemon environment.
    TZ: 'Asia/Shanghai',
    RUN_JOB_QUEUE: '0',
    RUN_MIGRATIONS: 'false',
    // Public, non-secret routing invariants for the MOYAO AI multi-store ingress.
    // Keeping these in the PM2 definition prevents an omitted encrypted env value
    // from silently falling back to the local development hostname.
    STORE_DOMAIN_CNAME_TARGET: 'stores.moyaoai.com',
    STORE_DOMAIN_ROUTING_MODE: 'require-domain',
    STORE_DOMAIN_BYPASS_HOSTS: '',
    STORE_DOMAIN_AUTOMATION_MODE: process.env.STORE_DOMAIN_AUTOMATION_MODE ?? 'manual',
    CLOUDFLARE_SAAS_API_TOKEN: process.env.CLOUDFLARE_SAAS_API_TOKEN,
    CLOUDFLARE_SAAS_ZONE_ID: process.env.CLOUDFLARE_SAAS_ZONE_ID,
    CLOUDFLARE_SAAS_FALLBACK_ORIGIN: process.env.CLOUDFLARE_SAAS_FALLBACK_ORIGIN,
    CLOUDFLARE_SAAS_AUTO_MANAGE_DNS: process.env.CLOUDFLARE_SAAS_AUTO_MANAGE_DNS ?? 'false',
    // The promotion page remains available at /promo, but the main storefront is always direct.
    STOREFRONT_PROMOTION_GATE_ENABLED: 'false',
    // Vendure's telemetry fallback writes .vendure/.installation-id below cwd,
    // which would mutate the verified immutable runtime directory.
    VENDURE_DISABLE_TELEMETRY: 'true',
    // Managed production releases activate a newly validated prompt Skill by default.
    // Operators can still disable this explicitly in the encrypted production .env.
    IMAGE_PROMPT_SKILL_AUTO_ACTIVATE: process.env.IMAGE_PROMPT_SKILL_AUTO_ACTIVATE ?? 'true',
};

const sharedProcessOptions = {
    max_memory_restart: '768M',
    restart_delay: 5000,
};

module.exports = {
    apps: [
        {
            name: 'vendure-worker',
            cwd: runtimeDirectory,
            script: 'packages/dev-server/dist/index-worker.js',
            interpreter: process.execPath,
            env: sharedEnvironment,
            ...sharedProcessOptions,
        },
        {
            name: 'vendure-api',
            cwd: runtimeDirectory,
            script: 'packages/dev-server/dist/index.js',
            interpreter: process.execPath,
            env: sharedEnvironment,
            ...sharedProcessOptions,
        },
    ],
};
