import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBillingReviewCli } from '../dist/image-provider-billing-cli.js';

// Compatibility entry for a source checkout. Production invokes the compiled CLI directly.
export {
    billingReviewConnectionOptions,
    parseBillingReviewArguments,
    runBillingReview,
    verifyBillingReviewManifest,
} from '../dist/image-provider-billing-cli.js';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await runBillingReviewCli(process.argv.slice(2));
}
