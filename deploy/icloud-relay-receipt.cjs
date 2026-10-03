'use strict';

const assert = require('node:assert/strict');

// Only this fixed operation transports the receipt filter; ordinary operations keep their SSM budget.
module.exports = function safeIcloudRelayReceipt(result, sourceSha, runtimeSha) {
    let receipt;
    try {
        assert.ok(Buffer.byteLength(result.stdout || '') <= 12288);
        receipt = JSON.parse(result.stdout);
        assert.equal(receipt.diagnostic, 'icloud-relay');
        const categories = new Set([
            'OK',
            'INVALID_CONFIGURATION',
            'CREDENTIALS_UNAVAILABLE',
            'DIAGNOSTIC_FAILED',
            'REQUEST_FAILED',
            'TIMEOUT',
            'BUDGET_EXHAUSTED',
            'HTTP_ERROR',
            'UNEXPECTED_CONTENT_TYPE',
            'PAYLOAD_LIMIT',
            'INVALID_JSON',
            'INVALID_ENVELOPE',
            'GRAPHQL_AUTHORIZATION',
            'GRAPHQL_SCHEMA',
            'GRAPHQL_ERROR',
            'LOGIN_FAILED',
            'LOGIN_REJECTED',
            'LOGIN_INVALID',
            'CHANNEL_LIMIT',
            'PARTIAL_FAILURE',
        ]);
        const operations = new Set([
            'login',
            'primary_minimal',
            'alias_minimal',
            'primary_full',
            'alias_full',
        ]);
        const errorCodes = new Set([
            'FORBIDDEN',
            'UNAUTHENTICATED',
            'GRAPHQL_VALIDATION_FAILED',
            'GRAPHQL_PARSE_FAILED',
            'BAD_USER_INPUT',
            'INTERNAL_SERVER_ERROR',
            'QUERY_TOO_COMPLEX',
            'MAX_QUERY_DEPTH_EXCEEDED',
        ]);
        const fields = new Set(
            (
                'icloudPrimaryAccounts icloudVirtualEmails login channels code token __typename ' +
                'id createdAt updatedAt email note status imapHost imapPort masterQueryCode ' +
                'codeExpiresAt codeResetIntervalDays remainingDays lastQueriedAt lastQueriedIp lastSyncedAt ' +
                'lastSyncError virtualEmailCount primaryAccountId primaryAccountEmail aliasEmail ' +
                'buyerQueryCode mailCount lastMailReceivedAt'
            ).split(' '),
        );
        const record = value => {
            assert.ok(value && categories.has(value.category) && operations.has(value.operation));
            assert.ok(
                value.status === null ||
                    (Number.isInteger(value.status) && value.status >= 100 && value.status <= 599),
            );
            assert.ok(
                ['json', 'graphql-json', 'html', 'text', 'other', 'missing'].includes(value.contentType),
            );
            assert.ok(
                value.count === null ||
                    (Number.isInteger(value.count) && value.count >= 0 && value.count <= 100000),
            );
            assert.ok(
                Number.isInteger(value.errorCount) && value.errorCount >= 0 && value.errorCount <= 1000000,
            );
            if (value.category === 'OK') {
                assert.ok(value.status >= 200 && value.status < 300);
                assert.ok(['json', 'graphql-json'].includes(value.contentType));
                assert.equal(value.errorCount, 0);
                assert.equal(value.code, null);
            }
            return {
                operation: value.operation,
                status: value.status,
                contentType: value.contentType,
                category: value.category,
                count: value.count,
                errorCount: value.errorCount,
                code: value.code === null ? null : errorCodes.has(value.code) ? value.code : 'UNKNOWN',
                path:
                    Array.isArray(value.path) &&
                    value.path.length <= 8 &&
                    value.path.every(
                        part => fields.has(part) || (Number.isInteger(part) && part >= 0 && part <= 9999),
                    )
                        ? value.path
                        : null,
            };
        };
        assert.ok(categories.has(receipt.category));
        assert.ok(
            Number.isInteger(receipt.channelCount) && receipt.channelCount >= 0 && receipt.channelCount <= 16,
        );
        assert.equal(typeof receipt.channelsTruncated, 'boolean');
        assert.ok(Array.isArray(receipt.channels) && receipt.channels.length <= 16);
        assert.ok(receipt.channels.length <= receipt.channelCount);
        if (receipt.category === 'OK') {
            assert.equal(result.status, 0);
            assert.ok(receipt.channelCount > 0 && !receipt.channelsTruncated);
            assert.equal(receipt.channels.length, receipt.channelCount);
            assert.equal(receipt.login?.operation, 'login');
            assert.equal(receipt.login?.category, 'OK');
            for (const channel of receipt.channels) {
                assert.equal(channel.probes.length, 4);
                assert.equal(new Set(channel.probes.map(probe => probe.operation)).size, 4);
                for (const probe of channel.probes) {
                    assert.ok(probe.operation !== 'login');
                    assert.equal(probe.category, 'OK');
                    assert.ok(Number.isInteger(probe.count));
                }
            }
        }
        const safe = {
            diagnostic: 'icloud-relay',
            category: receipt.category,
            login: receipt.login === null ? null : record(receipt.login),
            channelCount: receipt.channelCount,
            channelsTruncated: receipt.channelsTruncated,
            detailsOmitted: receipt.detailsOmitted === true,
            channels: receipt.channels.map((channel, index) => {
                assert.equal(channel.channelIndex, index + 1);
                assert.equal(typeof channel.isDefaultChannel, 'boolean');
                assert.ok(Array.isArray(channel.probes) && channel.probes.length <= 4);
                return {
                    channelIndex: channel.channelIndex,
                    isDefaultChannel: channel.isDefaultChannel,
                    probes: channel.probes.map(record),
                };
            }),
        };
        assert.ok(Buffer.byteLength(JSON.stringify(safe)) <= 16384);
        return { sourceSha: sourceSha, runtimeSha: runtimeSha, ...safe };
    } catch {
        throw new Error('Mailbox diagnostic receipt was invalid');
    }
};
