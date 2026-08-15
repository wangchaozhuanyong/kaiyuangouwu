import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const processRoles = new Set(['server', 'worker', 'migration']);
const operationsControls = [
    ['persistentAssetStorage', '持久化商品资源存储已验证'],
    ['databaseBackups', '数据库自动备份已启用'],
    ['restoreDrill', '数据库恢复演练已完成'],
    ['externalHealthChecks', '公网健康检查已启用'],
    ['alerting', '关键生产告警已启用'],
    ['secretManager', '生产密钥由 Secret 管理'],
];
const placeholderPattern = /^(?:abc|admin|changeme|example|password|superadmin|vendure-dev|replace[-_])/iu;

function normalized(value) {
    return String(value ?? '').trim();
}

function pushCheck(checks, { id, title, passed, detail, unresolved = false }) {
    checks.push({
        id,
        title,
        status: passed ? 'pass' : unresolved ? 'manual' : 'blocker',
        detail,
    });
}

function isPort(value) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isProductionUrl(value) {
    let url;
    try {
        url = new URL(normalized(value));
    } catch {
        return false;
    }
    return (
        url.protocol === 'https:' &&
        url.hostname !== 'localhost' &&
        url.hostname !== '127.0.0.1' &&
        !url.hostname.endsWith('.localhost')
    );
}

function isServiceUrl(value) {
    let url;
    try {
        url = new URL(normalized(value));
    } catch {
        return false;
    }
    return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.hostname !== 'localhost' &&
        url.hostname !== '127.0.0.1' &&
        !url.hostname.endsWith('.localhost')
    );
}

function isPublicHostname(value) {
    const hostname = normalized(value).toLowerCase().replace(/\.$/, '');
    return (
        hostname.includes('.') &&
        hostname !== 'localhost' &&
        hostname !== '127.0.0.1' &&
        hostname !== '0.0.0.0' &&
        !hostname.endsWith('.localhost') &&
        !hostname.endsWith('.example.com')
    );
}

function isConfiguredSecret(value, minimumLength) {
    const secret = normalized(value);
    return secret.length >= minimumLength && !placeholderPattern.test(secret);
}

function isPersistentDirectory(value) {
    const directory = normalized(value);
    return path.isAbsolute(directory) && directory !== path.parse(directory).root;
}

function hasRealEmailFrom(value) {
    const from = normalized(value).toLowerCase();
    return /@[^\s<>@]+\.[^\s<>@]+/u.test(from) && !from.includes('@example.com');
}

export function parseOperationsControls(value) {
    if (!value?.trim()) return {};
    const parsed = JSON.parse(value);
    assert.ok(
        parsed && typeof parsed === 'object' && !Array.isArray(parsed),
        'Operations controls must be an object',
    );
    for (const [name] of operationsControls) {
        if (parsed[name] != null) {
            assert.equal(typeof parsed[name], 'boolean', `${String(name)} must be a boolean`);
        }
    }
    return parsed;
}

export function evaluateProductionEnvironment(env, role, controls = {}) {
    assert.ok(processRoles.has(role), 'READINESS_PROCESS_ROLE must be server, worker, or migration');
    const checks = [];

    pushCheck(checks, {
        id: 'node-environment',
        title: '生产运行模式',
        passed: normalized(env.NODE_ENV) === 'production',
        detail:
            normalized(env.NODE_ENV) === 'production' ? 'NODE_ENV=production' : 'NODE_ENV is not production',
    });
    pushCheck(checks, {
        id: 'runtime-listener',
        title: '服务监听配置',
        passed: Boolean(normalized(env.VENDURE_HOSTNAME)) && isPort(env.PORT),
        detail:
            Boolean(normalized(env.VENDURE_HOSTNAME)) && isPort(env.PORT)
                ? 'configured'
                : 'hostname or port missing',
    });
    pushCheck(checks, {
        id: 'graphiql-disabled',
        title: '生产 GraphiQL 已关闭',
        passed: normalized(env.VENDURE_SERVE_GRAPHIQL) === 'false',
        detail: normalized(env.VENDURE_SERVE_GRAPHIQL) === 'false' ? 'disabled' : 'must be false',
    });

    const publicUrls = [env.VENDURE_DASHBOARD_URL, env.VENDURE_STOREFRONT_URL];
    pushCheck(checks, {
        id: 'public-https-urls',
        title: '管理端与前台兜底地址使用 HTTPS',
        passed: publicUrls.every(isProductionUrl),
        detail: publicUrls.every(isProductionUrl) ? 'configured' : 'missing, local, or not HTTPS',
    });

    const corsOrigins = normalized(env.VENDURE_CORS_ORIGINS)
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    pushCheck(checks, {
        id: 'cors-origins',
        title: '生产 CORS 来源白名单',
        passed: corsOrigins.length > 0 && corsOrigins.every(isProductionUrl),
        detail:
            corsOrigins.length > 0 && corsOrigins.every(isProductionUrl)
                ? 'configured'
                : 'missing or contains unsafe origin',
    });

    pushCheck(checks, {
        id: 'admin-identifier',
        title: '非默认超级管理员账号',
        passed:
            Boolean(normalized(env.SUPERADMIN_USERNAME)) &&
            normalized(env.SUPERADMIN_USERNAME) !== 'superadmin',
        detail:
            Boolean(normalized(env.SUPERADMIN_USERNAME)) &&
            normalized(env.SUPERADMIN_USERNAME) !== 'superadmin'
                ? 'configured'
                : 'missing or default',
    });
    pushCheck(checks, {
        id: 'admin-password',
        title: '超级管理员强密码',
        passed: isConfiguredSecret(env.SUPERADMIN_PASSWORD, 16),
        detail: isConfiguredSecret(env.SUPERADMIN_PASSWORD, 16)
            ? 'configured'
            : 'missing, short, or placeholder',
    });
    pushCheck(checks, {
        id: 'cookie-secret',
        title: 'Cookie 签名密钥',
        passed: isConfiguredSecret(env.COOKIE_SECRET, 32),
        detail: isConfiguredSecret(env.COOKIE_SECRET, 32) ? 'configured' : 'missing, short, or placeholder',
    });

    const databaseType = normalized(env.DB);
    const databaseFields = [env.DB_HOST, env.DB_USERNAME, env.DB_PASSWORD, env.DB_NAME];
    pushCheck(checks, {
        id: 'database-engine',
        title: '生产数据库引擎',
        passed: ['mysql', 'mariadb', 'postgres'].includes(databaseType),
        detail: ['mysql', 'mariadb', 'postgres'].includes(databaseType)
            ? databaseType
            : 'must use mysql, mariadb, or postgres',
    });
    pushCheck(checks, {
        id: 'database-connection',
        title: '生产数据库连接参数',
        passed:
            databaseFields.every(value => Boolean(normalized(value))) &&
            !['localhost', '127.0.0.1'].includes(normalized(env.DB_HOST).toLowerCase()) &&
            isPort(env.DB_PORT) &&
            isConfiguredSecret(env.DB_PASSWORD, 12) &&
            !placeholderPattern.test(normalized(env.DB_NAME)),
        detail:
            databaseFields.every(value => Boolean(normalized(value))) &&
            !['localhost', '127.0.0.1'].includes(normalized(env.DB_HOST).toLowerCase()) &&
            isPort(env.DB_PORT) &&
            isConfiguredSecret(env.DB_PASSWORD, 12) &&
            !placeholderPattern.test(normalized(env.DB_NAME))
                ? 'configured'
                : 'missing, local, invalid, or placeholder',
    });
    pushCheck(checks, {
        id: 'database-synchronize',
        title: '数据库自动同步已关闭',
        passed: normalized(env.DB_SYNCHRONIZE) === 'false',
        detail: normalized(env.DB_SYNCHRONIZE) === 'false' ? 'disabled' : 'must be false',
    });

    const assetUploadDir = normalized(env.VENDURE_ASSET_UPLOAD_DIR);
    const importAssetsDir = normalized(env.VENDURE_IMPORT_ASSETS_DIR);
    pushCheck(checks, {
        id: 'asset-directories',
        title: '资源目录使用独立绝对路径',
        passed:
            isPersistentDirectory(assetUploadDir) &&
            isPersistentDirectory(importAssetsDir) &&
            assetUploadDir !== importAssetsDir,
        detail:
            isPersistentDirectory(assetUploadDir) &&
            isPersistentDirectory(importAssetsDir) &&
            assetUploadDir !== importAssetsDir
                ? 'configured'
                : 'paths must be absolute, non-root, and distinct',
    });

    const smtpCredentialsMatch =
        Boolean(normalized(env.SMTP_USER)) === Boolean(normalized(env.SMTP_PASSWORD));
    pushCheck(checks, {
        id: 'smtp-transport',
        title: '生产邮件传输配置',
        passed:
            hasRealEmailFrom(env.VENDURE_EMAIL_FROM) &&
            isPublicHostname(env.SMTP_HOST) &&
            isPort(env.SMTP_PORT) &&
            ['true', 'false'].includes(normalized(env.SMTP_SECURE)) &&
            smtpCredentialsMatch,
        detail:
            hasRealEmailFrom(env.VENDURE_EMAIL_FROM) &&
            isPublicHostname(env.SMTP_HOST) &&
            isPort(env.SMTP_PORT) &&
            ['true', 'false'].includes(normalized(env.SMTP_SECURE)) &&
            smtpCredentialsMatch
                ? 'configured'
                : 'missing, placeholder, invalid, or incomplete credentials',
    });

    pushCheck(checks, {
        id: 'domain-routing',
        title: '生产域名路由配置',
        passed:
            isPublicHostname(env.STORE_DOMAIN_CNAME_TARGET) &&
            normalized(env.STORE_DOMAIN_ROUTING_MODE) === 'require-domain' &&
            !normalized(env.STORE_DOMAIN_BYPASS_HOSTS),
        detail:
            isPublicHostname(env.STORE_DOMAIN_CNAME_TARGET) &&
            normalized(env.STORE_DOMAIN_ROUTING_MODE) === 'require-domain' &&
            !normalized(env.STORE_DOMAIN_BYPASS_HOSTS)
                ? 'configured'
                : 'CNAME, routing mode, or bypass hosts are unsafe',
    });
    pushCheck(checks, {
        id: 'bootstrap-disabled',
        title: '基础 Schema 引导已关闭',
        passed: normalized(env.VENDURE_BOOTSTRAP_BASE_SCHEMA) === 'false',
        detail: normalized(env.VENDURE_BOOTSTRAP_BASE_SCHEMA) === 'false' ? 'disabled' : 'must be false',
    });

    const expectedRunMigrations = role === 'migration' ? 'true' : 'false';
    pushCheck(checks, {
        id: 'process-migrations',
        title: '进程迁移职责',
        passed: normalized(env.RUN_MIGRATIONS) === expectedRunMigrations,
        detail: `role=${String(role)}, RUN_MIGRATIONS must be ${expectedRunMigrations}`,
    });
    if (role !== 'worker') {
        pushCheck(checks, {
            id: 'server-job-queue',
            title: '非 Worker 进程不消费任务队列',
            passed: normalized(env.RUN_JOB_QUEUE) === '0',
            detail: normalized(env.RUN_JOB_QUEUE) === '0' ? 'disabled' : 'RUN_JOB_QUEUE must be 0',
        });
    }

    const instrumentationReady =
        normalized(env.IS_INSTRUMENTED) === 'true' &&
        isServiceUrl(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) &&
        isServiceUrl(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) &&
        Boolean(normalized(env.OTEL_SERVICE_NAME)) &&
        normalized(env.OTEL_SERVICE_NAME) !== 'vendure-dev-server';
    pushCheck(checks, {
        id: 'observability-export',
        title: '生产遥测导出配置',
        passed: instrumentationReady,
        detail: instrumentationReady ? 'configured' : 'instrumentation or OTEL endpoints missing or local',
    });

    for (const [name, title] of operationsControls) {
        const value = controls[name];
        pushCheck(checks, {
            id: `operations-${String(name)}`,
            title,
            passed: value === true,
            unresolved: value == null,
            detail:
                value === true
                    ? 'confirmed'
                    : value === false
                      ? 'explicitly not ready'
                      : 'confirmation not supplied',
        });
    }

    const summary = {
        pass: checks.filter(check => check.status === 'pass').length,
        manual: checks.filter(check => check.status === 'manual').length,
        blocker: checks.filter(check => check.status === 'blocker').length,
    };
    return { ready: summary.blocker === 0 && summary.manual === 0, role, summary, checks };
}

export function formatProductionEnvironmentReport(report) {
    const lines = [
        `Production environment readiness (${String(report.role)}): ${report.ready ? 'READY' : 'BLOCKED'}`,
        `pass=${String(report.summary.pass)} manual=${String(report.summary.manual)} blocker=${String(report.summary.blocker)}`,
    ];
    for (const check of report.checks.filter(item => item.status !== 'pass')) {
        lines.push(`${String(check.status).toUpperCase()} ${String(check.title)}: ${String(check.detail)}`);
    }
    return `${lines.join('\n')}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    try {
        const role = normalized(process.env.READINESS_PROCESS_ROLE);
        const report = evaluateProductionEnvironment(
            process.env,
            role,
            parseOperationsControls(process.env.READINESS_OPERATIONS_JSON),
        );
        process.stdout.write(
            process.argv.includes('--json')
                ? `${String(JSON.stringify(report, null, 2))}\n`
                : formatProductionEnvironmentReport(report),
        );
        process.exitCode = report.ready ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
