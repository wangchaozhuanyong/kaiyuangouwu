import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { verifyDashboardAssets } from './verify-production-release.mjs';

async function main() {
    const { values } = parseArgs({
        options: {
            'dashboard-url': { type: 'string' },
            'release-id': { type: 'string', default: String(Date.now()) },
            'timeout-ms': { type: 'string', default: '10000' },
        },
        strict: true,
    });
    if (!values['dashboard-url']) {
        throw new Error(
            'Usage: node deploy/verify-dashboard-assets.mjs --dashboard-url <url> [--release-id <id>]',
        );
    }
    const result = await verifyDashboardAssets({
        dashboardUrl: values['dashboard-url'],
        releaseId: values['release-id'],
        timeoutMs: Number(values['timeout-ms']),
    });
    process.stdout.write(`[pass] dashboard asset graph (${result.assetCount} assets)\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch(error => {
        process.stderr.write(`Dashboard asset verification failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}
