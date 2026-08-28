import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = JSON.parse(await readFile(path.join(skillRoot, 'dist', 'prompt-rules.bundle.json'), 'utf8'));
if (bundle.bundleVersion !== 1 || !/^[a-f0-9]{64}$/.test(bundle.sourceHash))
    throw new Error('Invalid rule bundle metadata');
if (bundle.models.length !== 4) throw new Error('Exactly four launch model profiles are required');
if (new Set(bundle.models.map(model => model.code)).size !== bundle.models.length)
    throw new Error('Duplicate model code');
if (new Set(bundle.useCases.map(item => item.code)).size !== bundle.useCases.length)
    throw new Error('Duplicate use-case code');
for (const required of bundle.schema.required) {
    if (!bundle.schema.properties[required]) throw new Error(`Missing schema property: ${required}`);
}
process.stdout.write('image-prompt-pro bundle is valid\n');
