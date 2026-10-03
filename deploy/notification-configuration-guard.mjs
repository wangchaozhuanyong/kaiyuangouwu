import assert from 'node:assert/strict';
import { createPublicKey, publicEncrypt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const flags = [
    'notifyOrderEvents',
    'notifyPaymentEvents',
    'notifyFulfillmentEvents',
    'notifyRefundEvents',
    'notifyInventoryEvents',
    'notifyOnlineReports',
    'notifyServiceReviews',
    'notifyPromotionExpiry',
    'notifyAiCredentials',
    'notifySecurityEvents',
];
const fields = `enabled tokenConfigured chatId adminBaseUrl timezone minSeverity sendResolved p2Silent p3Silent
    ${flags.join(' ')} inventoryLowThreshold p0RepeatMinutes p1RepeatMinutes p1EscalationMinutes
    departmentMentions routeOverrides`;

/** Sessions remain in memory. Backups contain notification settings, never Bot or login credentials. */
export async function configureUnifiedNotifications({
    sourceSha,
    mode = 'inspect',
    request = fetch,
    wait = delay,
    publicKey = process.env.OPS_NOTIFICATION_PUBLIC_KEY,
    botToken = process.env.TELEGRAM_BOT_TOKEN,
    backupDirectory = '/var/www/kaiyuangouwu/backups/notifications',
    username = process.env.SUPERADMIN_USERNAME,
    password = process.env.SUPERADMIN_PASSWORD,
} = {}) {
    assert.match(sourceSha ?? '', /^[a-f0-9]{40}$/u);
    assert.ok(['inspect', 'enable', 'transfer'].includes(mode));
    assert.ok(username && password, 'NOTIFICATION_ADMIN_CREDENTIALS_UNAVAILABLE');
    let auth = '';
    async function query(document, variables = {}) {
        try {
            const response = await request('http://127.0.0.1:3002/admin-api?languageCode=zh_Hans', {
                method: 'POST',
                signal: AbortSignal.timeout(30_000),
                headers: {
                    'content-type': 'application/json',
                    ...(auth ? { authorization: `Bearer ${auth}` } : {}),
                },
                body: JSON.stringify({ query: document, variables }),
            });
            assert.ok(response.ok);
            const result = await response.json();
            assert.ok(result.data && !result.errors?.length);
            auth ||= response.headers.get('vendure-auth-token') ?? '';
            return result.data;
        } catch {
            throw new Error('NOTIFICATION_API_REQUEST_FAILED');
        }
    }
    const login = await query(
        `mutation NotificationGuardLogin($username: String!, $password: String!) {
        login(username: $username, password: $password) { ... on CurrentUser { id } }
    }`,
        { username, password },
    );
    assert.ok(login.login?.id && auth, 'NOTIFICATION_ADMIN_LOGIN_FAILED');
    const configQuery = `query NotificationGuardConfig { telegramNotificationConfig { ${fields} }
        telegramNotificationStatus { running pending retrying dead oldestLagSeconds } }`;
    let { telegramNotificationConfig: config, telegramNotificationStatus: runtime } =
        await query(configQuery);
    const publicSummary = () => ({
        enabled: config.enabled,
        tokenConfigured: config.tokenConfigured,
        chatConfigured: Boolean(config.chatId),
        timezone: config.timezone,
        minSeverity: config.minSeverity,
        flags: Object.fromEntries(flags.map(flag => [flag, config[flag]])),
        runtime,
    });
    if (mode === 'inspect') return publicSummary();
    assert.ok(config.tokenConfigured && config.chatId, 'NOTIFICATION_BOT_OR_CHAT_UNCONFIGURED');
    if (mode === 'transfer') {
        assert.match(publicKey ?? '', /^[A-Za-z0-9+/=]{400,1000}$/u, 'NOTIFICATION_TRANSFER_KEY_INVALID');
        const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
        assert.ok(
            key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength >= 3072,
            'NOTIFICATION_TRANSFER_KEY_INVALID',
        );
        assert.ok(botToken?.trim(), 'NOTIFICATION_BOT_OR_CHAT_UNCONFIGURED');
        const encryptedNotificationCredentials = publicEncrypt(
            { key, oaepHash: 'sha256' },
            Buffer.from(JSON.stringify({ botToken: botToken.trim(), chatId: config.chatId })),
        ).toString('base64');
        return { encryptedNotificationCredentials };
    }
    assert.ok(runtime.running, 'NOTIFICATION_WORKER_UNAVAILABLE');
    const connection = await query('mutation NotificationGuardConnection { testTelegramConnection { ok } }');
    assert.ok(connection.testTelegramConnection.ok, 'NOTIFICATION_CONNECTION_FAILED');
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const backup = join(backupDirectory, `${sourceSha}.json`);
    try {
        await writeFile(backup, JSON.stringify({ sourceSha, config }, null, 2), { flag: 'wx', mode: 0o600 });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        assert.equal(JSON.parse(await readFile(backup, 'utf8')).sourceSha, sourceSha);
    }
    const input = {
        enabled: true,
        timezone: 'Asia/Kuala_Lumpur',
        minSeverity: 'P3',
        sendResolved: true,
        p2Silent: true,
        p3Silent: true,
        inventoryLowThreshold: 2,
        p0RepeatMinutes: 30,
        p1RepeatMinutes: 120,
        ...Object.fromEntries(flags.map(flag => [flag, true])),
    };
    await query(
        `mutation NotificationGuardEnable($input: UpdateTelegramNotificationConfigInput!) {
        updateTelegramNotificationConfig(input: $input) { enabled }
    }`,
        { input },
    );
    ({ telegramNotificationConfig: config, telegramNotificationStatus: runtime } = await query(configQuery));
    for (const [key, value] of Object.entries(input))
        assert.equal(config[key], value, `NOTIFICATION_READBACK_MISMATCH:${key}`);
    // Reuse a completed self-test receipt instead of sending another message on an operation retry.
    const receiptFile = join(backupDirectory, `${sourceSha}.receipt.json`);
    let receipt;
    try {
        receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    if (!receipt) {
        const result = await query(`mutation NotificationGuardTest {
            sendTelegramNotificationTest(kind: "RELEASE:${sourceSha}") { id }
        }`);
        receipt = { id: result.sendTelegramNotificationTest.id, verified: false };
        await writeFile(receiptFile, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
    }
    let record;
    for (let attempt = 0; attempt < 16; attempt++) {
        const sent = await query(`query NotificationGuardSent { telegramNotificationDeliveries(take: 100) {
        items { id deliveryStatus telegramMessageId title sentAt } } }`);
        record = sent.telegramNotificationDeliveries.items.find(item => item.id === receipt.id);
        if (record?.deliveryStatus === 'SENT' && record.telegramMessageId && record.sentAt) break;
        if (record?.deliveryStatus === 'DEAD') break;
        if (attempt < 15) await wait(2000);
    }
    assert.ok(
        record?.deliveryStatus === 'SENT' && record.telegramMessageId && record.sentAt,
        'NOTIFICATION_SELF_TEST_NOT_SENT',
    );
    assert.match(record.title, /\p{Script=Han}/u);
    await writeFile(
        receiptFile,
        JSON.stringify({ ...receipt, verified: true, messageId: record.telegramMessageId }),
        { mode: 0o600 },
    );
    return {
        ...publicSummary(),
        backupCreated: true,
        selfTest: {
            deliveryId: receipt.id,
            messageId: record.telegramMessageId,
            sentAt: record.sentAt,
            title: record.title,
        },
        telegramAccepted: true,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    configureUnifiedNotifications({ sourceSha: process.env.OPS_SOURCE_SHA, mode: process.argv[2] })
        .then(result => {
            process.stdout.write(`${JSON.stringify(result)}\nNOTIFICATION_CONFIGURATION_OK\n`);
        })
        .catch(error => {
            process.stderr.write(
                `${/^NOTIFICATION_[A-Z_:]+$/.test(error.message) ? error.message : 'NOTIFICATION_CONFIGURATION_FAILED'}\n`,
            );
            process.exitCode = 1;
        });
}
