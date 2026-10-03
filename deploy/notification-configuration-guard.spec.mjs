import assert from 'node:assert/strict';
import { generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { configureUnifiedNotifications } from './notification-configuration-guard.mjs';

const sourceSha = 'a'.repeat(40);
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
function fixture(directory, configured = true) {
    let config = {
        enabled: false,
        tokenConfigured: configured,
        chatId: '-100-test',
        ...Object.fromEntries(flags.map(flag => [flag, false])),
    };
    let sends = 0;
    const request = async (_url, options) => {
        const { query, variables } = JSON.parse(options.body);
        let data;
        if (query.includes('NotificationGuardLogin')) data = { login: { id: '1' } };
        else if (query.includes('NotificationGuardConfig'))
            data = {
                telegramNotificationConfig: config,
                telegramNotificationStatus: { running: true, pending: 0 },
            };
        else if (query.includes('NotificationGuardConnection'))
            data = { testTelegramConnection: { ok: true } };
        else if (query.includes('NotificationGuardEnable')) {
            const backup = JSON.parse(await readFile(join(directory, `${sourceSha}.json`), 'utf8'));
            assert.equal(backup.config.enabled, false);
            config = { ...config, ...variables.input };
            data = { updateTelegramNotificationConfig: { enabled: true } };
        } else if (query.includes('NotificationGuardTest')) {
            sends++;
            data = { sendTelegramNotificationTest: { id: '7' } };
        } else
            data = {
                telegramNotificationDeliveries: {
                    items: [
                        {
                            id: '7',
                            deliveryStatus: 'SENT',
                            telegramMessageId: '77',
                            title: '全店铺统一中文通知自检',
                            sentAt: new Date().toISOString(),
                        },
                    ],
                },
            };
        return new Response(JSON.stringify({ data }), {
            headers: { 'vendure-auth-token': 'session-must-stay-in-memory' },
        });
    };
    return { request, sends: () => sends };
}
test('backs up before enabling, reads back all switches, and retries without another self-test', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.tmp/notification-config-'));
    const fixtureApi = fixture(directory);
    const args = {
        sourceSha,
        mode: 'enable',
        request: fixtureApi.request,
        backupDirectory: directory,
        username: 'test',
        password: 'test-credential',
    };
    const result = await configureUnifiedNotifications(args);
    assert.equal(result.telegramAccepted, true);
    assert.ok(Object.values(result.flags).every(Boolean));
    await configureUnifiedNotifications(args);
    assert.equal(fixtureApi.sends(), 1);
    assert.doesNotMatch(JSON.stringify(result), /session-must-stay|test-credential|-100-test/);
});
test('does not enable or send when the existing Bot is absent', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.tmp/notification-config-'));
    const api = fixture(directory, false);
    await assert.rejects(
        configureUnifiedNotifications({
            sourceSha,
            mode: 'enable',
            request: api.request,
            backupDirectory: directory,
            username: 'test',
            password: 'test',
        }),
        /BOT_OR_CHAT_UNCONFIGURED/,
    );
    assert.equal(api.sends(), 0);
    assert.deepEqual(await readdir(directory), []);
});

test('transfers existing credentials only as ciphertext bound to the ephemeral recipient key', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.tmp/notification-config-'));
    const api = fixture(directory);
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
    const result = await configureUnifiedNotifications({
        sourceSha,
        mode: 'transfer',
        request: api.request,
        backupDirectory: directory,
        username: 'test',
        password: 'test',
        botToken: 'fixture-secret-token',
        publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    });
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret-token|-100-test/);
    const decrypted = JSON.parse(
        privateDecrypt(
            { key: privateKey, oaepHash: 'sha256' },
            Buffer.from(result.encryptedNotificationCredentials, 'base64'),
        ).toString(),
    );
    assert.deepEqual(decrypted, { botToken: 'fixture-secret-token', chatId: '-100-test' });
    assert.equal(api.sends(), 0);
    assert.deepEqual(await readdir(directory), []);
    await assert.rejects(
        configureUnifiedNotifications({
            sourceSha,
            mode: 'transfer',
            request: api.request,
            username: 'test',
            password: 'test',
            publicKey: 'invalid',
        }),
        /TRANSFER_KEY_INVALID/,
    );
});
test('waits for persisted worker delivery without sending another self-test', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.tmp/notification-config-'));
    const api = fixture(directory);
    let pending = true;
    let waits = 0;
    const result = await configureUnifiedNotifications({
        sourceSha,
        mode: 'enable',
        backupDirectory: directory,
        username: 'test',
        password: 'test',
        wait: async () => {
            await Promise.resolve();
            waits++;
            pending = false;
        },
        request: async (url, options) => {
            if (pending && JSON.parse(options.body).query.includes('NotificationGuardSent'))
                return new Response(
                    JSON.stringify({ data: { telegramNotificationDeliveries: { items: [] } } }),
                );
            return api.request(url, options);
        },
    });
    assert.equal(waits, 1);
    assert.equal(result.telegramAccepted, true);
    assert.equal(api.sends(), 1);
});
