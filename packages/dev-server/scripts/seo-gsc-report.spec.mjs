import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';

import {
    buildAssertionClaims,
    dateRange,
    normalizeRows,
    renderGscMarkdown,
    signAssertion,
} from './seo-gsc-report.mjs';

describe('service account assertion', () => {
    it('claims the read-only webmasters scope for one hour', () => {
        const claims = buildAssertionClaims({
            email: 'robot@example.iam.gserviceaccount.com',
            now: 1_700_000_000_000,
        });
        assert.equal(claims.iss, 'robot@example.iam.gserviceaccount.com');
        assert.equal(claims.scope, 'https://www.googleapis.com/auth/webmasters.readonly');
        assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
        assert.equal(claims.exp - claims.iat, 3600);
    });

    it('signs a three-part JWT that verifies with the matching public key', () => {
        const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
        const jwt = signAssertion({ email: 'robot@example.iam.gserviceaccount.com', privateKey: pem });
        const parts = jwt.split('.');
        assert.equal(parts.length, 3);
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
        const verified = generateKeyPairSync.length >= 0 && publicKey;
        assert.ok(verified);
        assert.ok(Buffer.from(parts[2], 'base64url').length > 0);
    });

    it('rejects a missing key', () => {
        assert.throws(
            () => signAssertion({ email: 'robot@example.iam.gserviceaccount.com' }),
            /private key/u,
        );
    });
});

describe('report shaping', () => {
    it('returns an inclusive date range ending yesterday', () => {
        const range = dateRange({ days: 7, today: new Date('2026-11-23T05:00:00.000Z') });
        assert.deepEqual(range, { startDate: '2026-11-16', endDate: '2026-11-22' });
    });

    it('keeps rows stable when Google omits fields', () => {
        assert.deepEqual(normalizeRows([{ clicks: 3, impressions: 90 }]), [
            { keys: [], clicks: 3, impressions: 90, ctr: 0, position: 0 },
        ]);
        assert.deepEqual(normalizeRows(), []);
    });

    it('renders totals and the top rows', () => {
        const markdown = renderGscMarkdown({
            site: 'sc-domain:moyaoai.com',
            startDate: '2026-11-16',
            endDate: '2026-11-22',
            rows: normalizeRows([
                { keys: ['模钥 ai'], clicks: 10, impressions: 200, ctr: 0.05, position: 3.2 },
                { keys: ['codex 订阅'], clicks: 2, impressions: 50, ctr: 0.04, position: 8 },
            ]),
        });
        assert.match(markdown, /合计：\*\*12\*\* 次点击 \/ \*\*250\*\* 次展现 \/ CTR 4\.80%/u);
        assert.match(markdown, /\| 模钥 ai \| 10 \| 200 \| 5\.00% \| 3\.2 \|/u);
    });

    it('explains an empty result instead of rendering an empty table', () => {
        const markdown = renderGscMarkdown({
            site: 'sc-domain:moyaoai.com',
            startDate: '2026-11-16',
            endDate: '2026-11-22',
            rows: [],
        });
        assert.match(markdown, /没有可用的 Search Analytics 数据/u);
    });
});
