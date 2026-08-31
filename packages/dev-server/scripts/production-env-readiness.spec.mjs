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
        PRODUCTION_DEPLOYMENT_PROFILE: 'managed-services',
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
        AUTO_CARD_ENCRYPTION_KEY: 'auto-card-secret-that-is-longer-than-thirty-two-characters',
        TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY:
            'dashboard-two-factor-key-that-is-longer-than-thirty-two-characters',
        VENDURE_GOOGLE_TRANSLATION_API_KEY: 'google-translation-api-key-for-production-tests',
        ORDER_CONFIRMATION_TOKEN_SECRET:
            'order-confirmation-secret-that-is-longer-than-thirty-two-characters',
        ORDER_CONFIRMATION_EMAIL_TOKEN_TTL_SECONDS: '604800',
        STOREFRONT_PROMOTION_GATE_ENABLED: 'true',
        STOREFRONT_ENTRY_SECRET: 'promotion-entry-secret-that-is-longer-than-thirty-two-characters',
        USDT_PAYMENT_PROOF_SECRET: 'usdt-proof-secret-that-is-longer-than-thirty-two-characters',
        USDT_WALLET_ENCRYPTION_KEY: 'usdt-wallet-key-that-is-longer-than-thirty-two-characters',
        USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS: '',
        USDT_REFUND_SENDER_ADDRESSES: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        DB: 'postgres',
        DB_HOST: 'database.internal',
        DB_PORT: '5432',
        DB_USERNAME: 'vendure-production',
        DB_PASSWORD: 'database-password-that-is-random',
        DB_NAME: 'vendure-production',
        DB_SYNCHRONIZE: 'false',
        VENDURE_ASSET_UPLOAD_DIR: '/srv/vendure/assets',
        VENDURE_IMPORT_ASSETS_DIR: '/srv/vendure/import-assets',
        DIGITAL_DELIVERY_ROOT: '/srv/vendure/digital-delivery',
        DIGITAL_DELIVERY_SIGNING_SECRET: '4ea7f8d3c91b6a205f74e8c1d9a3b6208f51d7c4a2e9630b',
        DIGITAL_DELIVERY_LINK_TTL_SECONDS: '300',
        IMAGE_GENERATION_STORAGE_ROOT: '/srv/vendure/image-generation-private',
        IMAGE_GENERATION_DOWNLOAD_SECRET: 'image-download-secret-that-is-longer-than-thirty-two-characters',
        IMAGE_GENERATION_MASTER_KEY: 'image-master-key-that-is-longer-than-thirty-two-characters',
        VENDURE_EMAIL_FROM: 'Store <orders@shop.test>',
        SMTP_HOST: 'smtp.resend.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'resend',
        SMTP_PASSWORD: 're_sending_only_api_key_for_tests',
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

const confirmedSingleHostControls = {
    persistentAssetStorage: true,
    databaseBackups: true,
    restoreDrill: true,
    externalHealthChecks: true,
    alerting: true,
    encryptedLocalSecrets: true,
};

void test('passes a complete server production environment', () => {
    const report = evaluateProductionEnvironment(readyEnvironment(), 'server', confirmedControls);
    assert.equal(report.ready, true);
    assert.deepEqual(report.summary, { pass: 35, manual: 0, blocker: 0 });
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
            SUPERADMIN_USERNAME: 'replace-with-admin',
            SUPERADMIN_PASSWORD: 'replace-with-password',
            ORDER_CONFIRMATION_TOKEN_SECRET: 'replace-with-a-secret',
            DB: 'sqlite',
            DB_HOST: '127.0.0.1',
            DB_NAME: 'vendure-dev',
            DIGITAL_DELIVERY_ROOT: './digital-delivery-assets',
            DIGITAL_DELIVERY_SIGNING_SECRET: 'replace-with-a-secret',
            IMAGE_GENERATION_STORAGE_ROOT: './image-generation-private',
            IMAGE_GENERATION_DOWNLOAD_SECRET: 'replace-with-a-secret',
            IMAGE_GENERATION_MASTER_KEY: 'replace-with-a-secret',
            SMTP_HOST: 'smtp.example.com',
            STORE_DOMAIN_CNAME_TARGET: 'stores.example.com',
            STORE_DOMAIN_ROUTING_MODE: 'prefer-domain',
            STORE_DOMAIN_BYPASS_HOSTS: 'localhost',
            STOREFRONT_PROMOTION_GATE_ENABLED: 'false',
            STOREFRONT_ENTRY_SECRET: 'replace-with-a-secret',
            USDT_WALLET_ENCRYPTION_KEY: 'replace-with-a-secret',
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
    assert.ok(blockers.has('order-confirmation-token-secret'));
    assert.ok(blockers.has('database-engine'));
    assert.ok(blockers.has('database-connection'));
    assert.ok(blockers.has('digital-delivery'));
    assert.ok(blockers.has('image-generation-storage'));
    assert.ok(blockers.has('smtp-transport'));
    assert.ok(blockers.has('domain-routing'));
    assert.ok(blockers.has('storefront-promotion-gate'));
    assert.ok(blockers.has('usdt-wallet-security'));
    assert.ok(blockers.has('observability-export'));
});

void test('blocks an unsafe digital order email token lifetime', () => {
    const report = evaluateProductionEnvironment(
        readyEnvironment({ ORDER_CONFIRMATION_EMAIL_TOKEN_TTL_SECONDS: '2592001' }),
        'server',
        confirmedControls,
    );
    const check = report.checks.find(item => item.id === 'order-confirmation-token-secret');
    assert.equal(check?.status, 'blocker');
});

void test('blocks incomplete authentication and invalid Resend TLS settings', () => {
    const missingCredentials = evaluateProductionEnvironment(
        readyEnvironment({ SMTP_USER: '', SMTP_PASSWORD: '' }),
        'server',
        confirmedControls,
    );
    const wrongResendUser = evaluateProductionEnvironment(
        readyEnvironment({ SMTP_USER: 'api-user' }),
        'server',
        confirmedControls,
    );
    const wrongTlsPair = evaluateProductionEnvironment(
        readyEnvironment({ SMTP_PORT: '587', SMTP_SECURE: 'true' }),
        'server',
        confirmedControls,
    );

    expectSmtpBlocker(missingCredentials);
    expectSmtpBlocker(wrongResendUser);
    expectSmtpBlocker(wrongTlsPair);
});

void test('keeps operational evidence as explicit manual gates', () => {
    const report = evaluateProductionEnvironment(readyEnvironment(), 'server');
    assert.equal(report.ready, false);
    assert.equal(report.summary.manual, 6);
});

void test('allows a verified single-host database and system monitoring profile', () => {
    const report = evaluateProductionEnvironment(
        readyEnvironment({
            PRODUCTION_DEPLOYMENT_PROFILE: 'single-host',
            PRODUCTION_OBSERVABILITY_MODE: 'system',
            DB_HOST: '127.0.0.1',
            IS_INSTRUMENTED: 'false',
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',
            OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: '',
            OTEL_SERVICE_NAME: '',
            VENDURE_REQUIRE_OFFSITE_BACKUP: 'true',
            VENDURE_BACKUP_S3_URI: 's3://production-backups/vendure/mysql',
        }),
        'server',
        confirmedSingleHostControls,
    );

    assert.equal(report.ready, true);
    assert.deepEqual(report.summary, { pass: 36, manual: 0, blocker: 0 });
});

void test('blocks a missing or placeholder auto-card encryption key', () => {
    for (const value of ['', 'replace-with-a-random-secret-at-least-32-characters']) {
        const report = evaluateProductionEnvironment(
            readyEnvironment({ AUTO_CARD_ENCRYPTION_KEY: value }),
            'server',
            confirmedControls,
        );
        assert.equal(report.ready, false);
        assert.equal(
            report.checks.some(
                check => check.id === 'auto-card-encryption-key' && check.status === 'blocker',
            ),
            true,
        );
    }
});

void test('blocks a missing or placeholder dashboard 2FA encryption key', () => {
    for (const value of ['', 'replace-with-a-random-secret-at-least-32-characters']) {
        const report = evaluateProductionEnvironment(
            readyEnvironment({ TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY: value }),
            'server',
            confirmedControls,
        );
        assert.equal(report.ready, false);
        assert.equal(
            report.checks.some(
                check => check.id === 'dashboard-two-factor-encryption-key' && check.status === 'blocker',
            ),
            true,
        );
    }
});

void test('blocks unsafe AI image storage configuration for server and worker', () => {
    for (const role of ['server', 'worker']) {
        const report = evaluateProductionEnvironment(
            readyEnvironment({
                IMAGE_GENERATION_STORAGE_ROOT: './image-generation-private',
                IMAGE_GENERATION_DOWNLOAD_SECRET: 'replace-with-a-secret',
                IMAGE_GENERATION_MASTER_KEY: '',
            }),
            role,
            confirmedControls,
        );
        assert.equal(report.ready, false);
        assert.equal(
            report.checks.some(
                check => check.id === 'image-generation-storage' && check.status === 'blocker',
            ),
            true,
        );
    }
});

void test('blocks production without a configured customer-content translation provider', () => {
    for (const value of ['', 'replace-with-google-api-key']) {
        const report = evaluateProductionEnvironment(
            readyEnvironment({ VENDURE_GOOGLE_TRANSLATION_API_KEY: value }),
            'server',
            confirmedControls,
        );
        assert.equal(report.ready, false);
        assert.equal(
            report.checks.some(
                check => check.id === 'content-translation-provider' && check.status === 'blocker',
            ),
            true,
        );
    }
});

void test('blocks unsafe USDT settlement, wallet encryption and refund allowlist settings', () => {
    for (const overrides of [
        { USDT_PAYMENT_PROOF_SECRET: 'replace-with-proof-secret' },
        { USDT_WALLET_ENCRYPTION_KEY: '' },
        { USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS: 'short-previous-key' },
        {
            USDT_WALLET_ENCRYPTION_KEY: 'usdt-proof-secret-that-is-longer-than-thirty-two-characters',
        },
        {
            USDT_WALLET_ENCRYPTION_PREVIOUS_KEYS: 'usdt-wallet-key-that-is-longer-than-thirty-two-characters',
        },
        { USDT_REFUND_SENDER_ADDRESSES: 'not-a-tron-address' },
    ]) {
        const report = evaluateProductionEnvironment(
            readyEnvironment(overrides),
            'server',
            confirmedControls,
        );
        assert.equal(report.ready, false);
        assert.equal(
            report.checks.some(
                check =>
                    (check.id === 'usdt-wallet-security' || check.id === 'usdt-refund-sender-allowlist') &&
                    check.status === 'blocker',
            ),
            true,
        );
    }
});

void test('allows deployment without refund senders while marking manual refunds disabled', () => {
    const report = evaluateProductionEnvironment(
        readyEnvironment({ USDT_REFUND_SENDER_ADDRESSES: '' }),
        'server',
        confirmedControls,
    );

    assert.equal(report.ready, true);
    assert.deepEqual(
        report.checks.find(check => check.id === 'usdt-refund-sender-allowlist'),
        {
            id: 'usdt-refund-sender-allowlist',
            title: 'USDT 人工退款付款钱包白名单',
            status: 'pass',
            detail: 'not configured; manual USDT refund registration remains disabled',
        },
    );
});

void test('blocks a single-host release without a required offsite backup destination', () => {
    const report = evaluateProductionEnvironment(
        readyEnvironment({
            PRODUCTION_DEPLOYMENT_PROFILE: 'single-host',
            PRODUCTION_OBSERVABILITY_MODE: 'system',
            DB_HOST: '127.0.0.1',
            IS_INSTRUMENTED: 'false',
            VENDURE_REQUIRE_OFFSITE_BACKUP: 'false',
            VENDURE_BACKUP_S3_URI: '',
        }),
        'server',
        confirmedSingleHostControls,
    );

    assert.equal(
        report.checks.some(check => check.id === 'offsite-database-backup' && check.status === 'blocker'),
        true,
    );
});

void test('blocks an unverified local database in the single-host profile', () => {
    const report = evaluateProductionEnvironment(
        readyEnvironment({
            PRODUCTION_DEPLOYMENT_PROFILE: 'single-host',
            PRODUCTION_OBSERVABILITY_MODE: 'system',
            DB_HOST: '127.0.0.1',
        }),
        'server',
        { ...confirmedSingleHostControls, restoreDrill: false },
    );

    assert.equal(report.ready, false);
    assert.equal(
        report.checks.some(check => check.id === 'database-connection' && check.status === 'blocker'),
        true,
    );
});

void test('parses controls and never prints secret values', () => {
    assert.deepEqual(parseOperationsControls(JSON.stringify(confirmedControls)), confirmedControls);
    assert.throws(
        () => parseOperationsControls('{"databaseBackups":"yes"}'),
        /databaseBackups must be a boolean/,
    );
    assert.throws(
        () => parseOperationsControls('{"encryptedLocalSecrets":"yes"}'),
        /encryptedLocalSecrets must be a boolean/,
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

function expectSmtpBlocker(report) {
    assert.equal(report.ready, false);
    assert.equal(
        report.checks.some(check => check.id === 'smtp-transport' && check.status === 'blocker'),
        true,
    );
}
