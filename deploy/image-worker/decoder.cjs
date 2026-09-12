'use strict';
// No network client, database, configuration loader or customer credentials in this process.
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { normalizeCustomerImage } = require(
    path.join(__dirname, '../../packages/core/dist/common/normalize-customer-image.js'),
);
(async () => {
    try {
        const bytes = await readFile(process.argv[2]);
        const result = await normalizeCustomerImage(bytes, process.argv[3]);
        process.send({ bytes: result.toString('base64') }, () => process.exit(0));
    } catch {
        process.send({ error: 'IMAGE_INVALID' }, () => process.exit(1));
    }
})();
