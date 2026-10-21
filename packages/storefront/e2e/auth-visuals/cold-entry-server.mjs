import { readFile } from 'node:fs/promises';

import { startSeoFixtureServer } from '../seo-public/preview-server.mjs';
import { fixtureData } from '../visual-presets/fixtures.mjs';

// Real built router/bootstrap/API, synthetic responses only. No email or account is changed.
const events = [];
let verified = false;
let configurationReturned = false;
let scenario = 'automatic';
let failedRead = false;
const server = await startSeoFixtureServer(5358, {
    listenHost: '127.0.0.1',
    transformHtml: () => readFile(new URL('../../dist/index.html', import.meta.url), 'utf8'),
    async serveAssets(request, response) {
        const url = new URL(request.url, 'http://localhost');
        const pathname = url.pathname;
        if (pathname === '/__qa/cold-entry') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ scenario, configurationReturned, verified, events }));
            return true;
        }
        if (pathname === '/promo/account-entry') {
            events.length = 0;
            verified = false;
            configurationReturned = false;
            scenario = url.searchParams.get('scenario') ?? 'automatic';
            failedRead = false;
            response.writeHead(303, { location: '/#/verify-account?token=synthetic-local-one-time' });
            response.end();
            return true;
        }
        if (pathname === '/' && scenario === 'server-rendered') return false;
        if (pathname === '/' || pathname === '/verify-account' || pathname === '/login') {
            response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
            response.end(await readFile(new URL('../../dist/index.html', import.meta.url), 'utf8'));
            return true;
        }
        return false;
    },
    async transformGraphQlData(data, { operation }) {
        const query = String(operation.query ?? '');
        if (query.includes('query StorefrontConfig')) {
            events.push({ event: 'configuration-started' });
            await new Promise(resolve => setTimeout(resolve, 800));
            if (
                scenario === 'configuration-failure' &&
                events.filter(item => item.event === 'configuration-failed').length < 2
            ) {
                events.push({ event: 'configuration-failed' });
                throw new Error('Synthetic configuration failure');
            }
            configurationReturned = true;
            events.push({ event: 'configuration-returned' });
        }
        if (query.includes('mutation VerifyStorefrontCustomer')) {
            const hasPassword = Boolean(operation.variables?.password);
            events.push({
                event: 'verify-dispatched',
                configurationReturned,
                previouslyVerified: verified,
                hasPassword,
            });
            if (scenario === 'password' && !hasPassword) {
                data.verifyCustomerAccount = {
                    __typename: 'MissingPasswordError',
                    errorCode: 'MISSING_PASSWORD_ERROR',
                    message: 'Synthetic password required',
                };
                return;
            }
            data.verifyCustomerAccount = verified
                ? {
                      __typename: 'VerificationTokenInvalidError',
                      errorCode: 'VERIFICATION_TOKEN_INVALID_ERROR',
                      message: 'Synthetic token already consumed',
                  }
                : { __typename: 'CurrentUser', id: 'qa-user', identifier: 'local@example.invalid' };
            verified = true;
        }
        if (
            scenario === 'session-failure' &&
            verified &&
            /query StorefrontCustomer\s*\{/u.test(query) &&
            !failedRead
        ) {
            failedRead = true;
            events.push({ event: 'session-read-failed' });
            throw new Error('Synthetic session read failure');
        }
        data.activeCustomer = verified ? fixtureData('classic', true).activeCustomer : null;
    },
});
process.stdout.write(`Synthetic cold email entry: http://127.0.0.1:${server.port}/promo/account-entry\n`);
