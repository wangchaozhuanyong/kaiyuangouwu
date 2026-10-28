/** Summarize existing local evidence; never controls a browser or contacts production. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizeReport } from './report-summary.mjs';
import { reportRoot } from './scenario-fixture.mjs';
const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
for (const label of process.argv.slice(2)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(label)) throw new Error('Invalid evidence label');
    const directory = path.join(project, reportRoot, label);
    const reports = [];
    for (const file of (await readdir(directory)).filter(name => /^\d.*\.json$/u.test(name)).sort()) {
        const report = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
        reports.push({ file, ...summarizeReport(report) });
    }
    await writeFile(path.join(directory, 'summary.json'), JSON.stringify(reports, null, 2));
    process.stdout.write(
        JSON.stringify(
            {
                label,
                reports: reports.map(({ geometry, resources, events, imageCandidates, ...report }) => report),
            },
            null,
            2,
        ) + '\n',
    );
}
