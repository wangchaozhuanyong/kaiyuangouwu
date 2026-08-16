import assert from 'node:assert/strict';
import test from 'node:test';

import {
    evaluateProductionEnvironment,
    formatProductionEnvironmentReport,
    parseOperationsControls,
} from './production-env-readiness.mjs';

function readyEnvironment(overrides = {}) {
    return {
        NODE_ENV: 'production',
        TZ: 'Asia/Shanghai',
        VENDURE_HOSTNAME: '0.0.0.0',
        PORT: '3000',
        VENDURE_SERVE_GRAPHIQL: 'false',
        VENDURE_DASHBOARD_URL: 'https://admin.shop.test',
        VENDURE_STOREFRONT_URL: 'https://shop.test',
        VENDURE_CORS_ORIGINS: 'https://admin.shop.test,https://shop.test',
        SUPERADMIN_USERNAME: 'operations-admin',
        SUPERADMIN_PASSWORD: 'p4ssword-that-is-long-and-random',
        COOKIE_SECRET: 'cookie-secret-that-is-longer-than-thirty-two-characters',
        DB: 'postgres',
        DB_HOST: 'database.internal',
        DB_PORT: '5432',
        DB_USERNAME: 'vendure-production',
        DB_PASSWORD: 'database-password-that-is-random',
        DB_NAME: 'vendure-production',
        DB_SYNCHRONIZE: 'false',
        VENDURE_ASSET_UPLOAD_DIR: '/srv/vendure/assets',
        VENDURE_IMPORT_ASSETS_DIR: '/srv/vendure/import-assets',
        VENDURE_EMAIL_FROM: 'Store <orders@shop.test>',
        SMTP_HOST: 'smtp.shop.test',
        SMTP_PORT: '587',
        SMTP_SECURE: 'false',
        SMTP_USER: 'smtp-user',
        SMTP_PASSWORD: 'smtp-password',
        STORE_DOMAIN_CNAME_TARGET: 'stores.shop.test',
        STORE_DOMAIN_ROUTING_MODE: 'require-domain',
        STORE_DOMAIN_BYPASS_HOSTS: '',
        VENDURE_BOOTSTRAP_BASE_SCHEMA: 'false',
        RUN_MIGRATIONS: 'false',
        RUN_JOB_QUEUE: '0',
        IS_INSTRUMENTED: 'true',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://otel.internal/v1/traces',
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://otel.internal/v1/logs',
        OTEL_SERVICE_NAME: 'vendure-api',
        ...overrides,
    };
}

const confirmedControls = {
    persistentAssetStorage: true,
    databaseBackups: true,
    restoreDrill: true,
    externalHealthChecks: true,
    alerting: true,
    secretManager: true,
};

void test('passes a complete server production environment', () => {
    const report = evaluateProductionEnvironment(readyEnvironment(), 'server', confirmedControls);
    assert.equal(report.ready, true);
    assert.deepEqual(report.summary, { pass: 25, manual: 0, blocker: 0 });
});

void test('uses different migration expectations for worker and migration roles', () => {
    const worker = evaluateProductionEnvironment(readyEnvironment(), 'worker', confirmedControls);
    const migration = evaluateProductionEnvironment(
        readyEnvironment({ RUN_MIGRATIONS: 'true' }),
        'migration',
        confirmedControls,
    );
    assert.equal(worker.ready, true);
    assert.equal(migration.ready, true);
});

void test('blocks local services, placeholders, unsafe routing and default credentials', () => {
    const report = evaluateProductionEnvironment(
        readyEnvironment({
            NODE_ENV: 'development',
            TZ: 'America/Los_Angeles',
            VENDURE_DASHBOARD_URL: 'http://localhost:3000/dashboard',
            VENDURE_CORS_ORIGINS: 'http://localhost:5173',
            SUPERADMIN_USERNAME: 'superadmin',
            SUPERADMIN_PASSWORD: 'replace-with-password',
            DB: 'sqlite',
            DB_HOST: '127.0.0.1',
            DB_NAME: 'vendure-dev',
            SMTP_HOST: 'smtp.example.com',
            STORE_DOMAIN_CNAME_TARGET: 'stores.example.com',
            STORE_DOMAIN_ROUTING_MODE: 'prefer-domain',
            STORE_DOMAIN_BYPASS_HOSTS: 'localhost',
            IS_INSTRUMENTED: 'false',
        }),
        'server',
        confirmedControls,
    );
    const blockers = new Set(
        report.checks.filter(check => check.status === 'blocker').map(check => check.id),
    );
    assert.equal(report.ready, false);
    assert.ok(blockers.has('node-environment'));
    assert.ok(blockers.has('business-time-zone'));
    assert.ok(blockers.has('public-https-urls'));
    assert.ok(blockers.has('cors-origins'));
    assert.ok(blockers.has('admin-identifier'));
    assert.ok(blockers.has('admin-password'));
    assert.ok(blockers.has('database-engine'));
    assert.ok(blockers.has('database-connection'));
    assert.ok(blockers.has('smtp-transport'));
    assert.ok(blockers.has('domain-routing'));
    assert.ok(blockers.has('observability-export'));
});

void test('keeps operational evidence as explicit manual gates', () => {
    const report = evaluateProductionEnvironment(readyEnvironment(), 'server');
    assert.equal(report.ready, false);
    assert.equal(report.summary.manual, 6);
});

void test('parses controls and never prints secret values', () => {
    assert.deepEqual(parseOperationsControls(JSON.stringify(confirmedControls)), confirmedControls);
    assert.throws(
        () => parseOperationsControls('{"databaseBackups":"yes"}'),
        /databaseBackups must be a boolean/,
    );
    const password = 'private-password-value-that-must-not-leak';
    const report = evaluateProductionEnvironment(
        readyEnvironment({ SUPERADMIN_PASSWORD: password }),
        'server',
        confirmedControls,
    );
    assert.equal(formatProductionEnvironmentReport(report).includes(password), false);
    assert.equal(JSON.stringify(report).includes(password), false);
});
