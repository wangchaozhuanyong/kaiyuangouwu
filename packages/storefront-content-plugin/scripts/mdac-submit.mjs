#!/usr/bin/env node
/**
 * Manual driver for the MDAC submission bot.
 *
 *   node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
 *   node scripts/mdac-submit.mjs --payload traveler.json            # dry run
 *   node scripts/mdac-submit.mjs --payload traveler.json --submit   # real submit
 *
 * The payload file holds the official field names (see
 * src/mdac-submission/mdac-submission.types.ts). Dry run fills the whole form,
 * solves the slider and stops before the Submit button, which is the safest way
 * to confirm selectors after the immigration site changes.
 */
import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const readArg = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};

const payloadPath = readArg('--payload');
if (!payloadPath) {
    console.error('usage: node scripts/mdac-submit.mjs --payload traveler.json [--submit] [--headful]');
    process.exit(2);
}

const { MdacSubmitter } = await import('../dist/mdac-submission/mdac-submitter.js');

const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
const submitter = new MdacSubmitter({
    dryRun: !args.includes('--submit'),
    headless: !args.includes('--headful'),
    proxy: process.env.STOREFRONT_MDAC_SUBMIT_PROXY,
    channel: process.env.STOREFRONT_MDAC_SUBMIT_CHANNEL?.trim() || undefined,
});
const log = [];
const outcome = await submitter.submit(payload, log);

const printable = {
    status: outcome.status,
    reason: outcome.reason,
    detail: outcome.detail,
    referenceNo: outcome.referenceNo,
    pin: outcome.pin,
    pdf: outcome.pdf ? `${outcome.pdf.length} bytes written to mdac-receipt.pdf` : undefined,
    screenshot: outcome.screenshot ? 'written to mdac-last-run.jpg' : undefined,
    log: outcome.log,
};
console.log(JSON.stringify(printable, null, 2));
if (outcome.screenshot) {
    const base64 = outcome.screenshot.replace(/^data:image\/jpeg;base64,/, '');
    await writeFile('mdac-last-run.jpg', Buffer.from(base64, 'base64'));
}
if (outcome.pdf) await writeFile('mdac-receipt.pdf', outcome.pdf);
process.exit(outcome.status === 'DONE' || outcome.status === 'MANUAL' ? 0 : 1);
