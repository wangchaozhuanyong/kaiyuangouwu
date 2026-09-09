import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isLocalApiOrigin } from './repair-inventory-inheritance.mjs';

export async function runCouponRepair({
    apiOrigin,
    channelId,
    campaignId,
    username,
    password,
    out,
    planFile,
    apply = false,
    allowRemote = false,
    fetchImpl = fetch,
}) {
    const origin = new URL(apiOrigin).origin;
    assert.ok(username && password, 'SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required');
    assert.ok(channelId && campaignId && out, '--channel-id, --campaign-id and --out are required');
    assert.ok(
        !apply || isLocalApiOrigin(origin) || allowRemote,
        'Remote writes require --apply --allow-remote',
    );
    let reviewed;
    if (apply) {
        assert.ok(planFile, '--apply requires a previously saved --plan');
        reviewed = JSON.parse(await fs.readFile(planFile, 'utf8'));
        assert.equal(reviewed.target.apiOrigin, origin, 'Preview belongs to a different API');
        assert.equal(reviewed.target.channelId, channelId, 'Preview belongs to a different Channel');
        assert.equal(reviewed.target.campaignId, campaignId, 'Preview belongs to a different campaign');
        assert.ok(reviewed.plan.fingerprint, 'Preview fingerprint is missing');
    }
    const output = await fs.open(out, 'wx', 0o600);
    try {
        let authToken = '';
        let channelToken = '';
        async function request(query, variables) {
            const response = await fetchImpl(origin + '/admin-api', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(authToken ? { authorization: 'Bearer ' + authToken } : {}),
                    ...(channelToken ? { 'vendure-token': channelToken } : {}),
                },
                body: JSON.stringify({ query, variables }),
            });
            const body = await response.json();
            if (!response.ok || body.errors?.length || !body.data)
                throw new Error(
                    body.errors?.map(error => error.message).join('; ') || 'GraphQL request failed',
                );
            authToken = response.headers.get('vendure-auth-token') || authToken;
            return body.data;
        }
        const login = await request(
            `mutation($username: String!, $password: String!) {
                login(username: $username, password: $password, rememberMe: false) {
                    ... on CurrentUser { id channels { id token } }
                    ... on ErrorResult { errorCode }
                }
            }`,
            { username, password },
        );
        assert.ok(!login.login.errorCode && authToken, 'Admin login failed');
        const channel = login.login.channels.find(item => item.id === channelId);
        assert.ok(channel, 'The authenticated administrator does not have the selected Channel');
        channelToken = channel.token;
        let result;
        if (apply) {
            result = (
                await request(
                    `mutation($campaignId: ID!, $fingerprint: String!, $password: String!) {
                        repairStoreCouponCampaign(campaignId: $campaignId, fingerprint: $fingerprint, password: $password)
                    }`,
                    { campaignId, fingerprint: reviewed.plan.fingerprint, password },
                )
            ).repairStoreCouponCampaign;
        } else {
            result = (
                await request(
                    'query($campaignId: ID!) { storeCouponRepairPreview(campaignId: $campaignId) }',
                    { campaignId },
                )
            ).storeCouponRepairPreview;
        }
        const artifact = {
            target: { apiOrigin: origin, channelId, campaignId },
            ...(apply ? { receipt: result } : { plan: result }),
        };
        // A review snapshot is immutable; use a new output name for each preview/receipt.
        await output.writeFile(JSON.stringify(artifact, null, 2) + '\n');
        return artifact;
    } finally {
        await output.close();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { values } = parseArgs({
        options: {
            'api-origin': { type: 'string' },
            'channel-id': { type: 'string' },
            'campaign-id': { type: 'string' },
            out: { type: 'string' },
            plan: { type: 'string' },
            apply: { type: 'boolean', default: false },
            'allow-remote': { type: 'boolean', default: false },
        },
    });
    runCouponRepair({
        apiOrigin: values['api-origin'] ?? process.env.VENDURE_API_ORIGIN ?? 'http://127.0.0.1:3000',
        channelId: values['channel-id'],
        campaignId: values['campaign-id'],
        out: values.out,
        planFile: values.plan,
        username: process.env.SUPERADMIN_USERNAME,
        password: process.env.SUPERADMIN_PASSWORD,
        apply: values.apply,
        allowRemote: values['allow-remote'],
    })
        .then(result => {
            const report = result.plan ?? result.receipt.after;
            process.stdout.write(
                JSON.stringify({
                    channelId: report.channelId,
                    campaignId: report.campaignId,
                    mode: values.apply ? 'applied' : 'preview',
                    changedCoupons: result.receipt?.changedCoupons ?? report.changes.coupons.length,
                    output: values.out,
                }) + '\n',
            );
        })
        .catch(error => {
            process.stderr.write(
                String(error.message).replaceAll(process.env.SUPERADMIN_PASSWORD || '\u0000', '[redacted]') +
                    '\n',
            );
            process.exitCode = 1;
        });
}
