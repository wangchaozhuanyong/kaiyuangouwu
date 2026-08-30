import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = JSON.parse(await readFile(path.join(skillRoot, 'dist', 'prompt-rules.bundle.json'), 'utf8'));
const sortObject = value => {
    if (Array.isArray(value)) return value.map(sortObject);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map(key => [key, sortObject(value[key])]),
    );
};
if (bundle.bundleVersion !== 1 || !/^[a-f0-9]{64}$/.test(bundle.sourceHash))
    throw new Error('Invalid rule bundle metadata');
const { bundleVersion, sourceHash, ...sources } = bundle;
const calculatedHash = createHash('sha256')
    .update(JSON.stringify(sortObject(sources)))
    .digest('hex');
if (calculatedHash !== sourceHash) throw new Error('Rule bundle source hash does not match its contents');
if (bundle.models.length !== 4) throw new Error('Exactly four launch model profiles are required');
if (new Set(bundle.models.map(model => model.code)).size !== bundle.models.length)
    throw new Error('Duplicate model code');
for (const model of bundle.models) {
    if (!model.code || !model.officialModelId || !model.displayNameZh || !model.displayNameEn) {
        throw new Error('Every model profile requires code, official ID, and bilingual names');
    }
}
if (new Set(bundle.useCases.map(item => item.code)).size !== bundle.useCases.length)
    throw new Error('Duplicate use-case code');
const expectedUseCases = [
    'ecommerce-poster',
    'illustration',
    'interior-design',
    'portrait',
    'product-photo',
    'reference-edit',
];
const actualUseCases = bundle.useCases.map(item => item.code).sort();
if (JSON.stringify(actualUseCases) !== JSON.stringify(expectedUseCases)) {
    throw new Error(`Unexpected use-case set: ${actualUseCases.join(', ')}`);
}
for (const useCase of bundle.useCases) {
    if (
        !useCase.defaults?.composition ||
        !useCase.defaults?.lighting ||
        !useCase.defaults?.style ||
        !useCase.defaultsZh?.composition ||
        !useCase.defaultsZh?.lighting ||
        !useCase.defaultsZh?.style ||
        !Array.isArray(useCase.avoid) ||
        useCase.avoid.length === 0 ||
        !Array.isArray(useCase.avoidZh) ||
        useCase.avoidZh.length === 0
    ) {
        throw new Error(`Incomplete use-case profile: ${useCase.code}`);
    }
}
if (!['BALANCED', 'QUALITY', 'SPEED', 'COST'].includes(bundle.routing.defaultStrategy)) {
    throw new Error(`Unsupported default routing strategy: ${bundle.routing.defaultStrategy}`);
}
const priorities = bundle.routing.rules.map(rule => rule.priority);
if (
    priorities.some(priority => !Number.isInteger(priority) || priority < 0) ||
    new Set(priorities).size !== priorities.length
) {
    throw new Error('Routing priorities must be unique non-negative integers');
}
const modelCodes = new Set(bundle.models.map(model => model.code));
for (const rule of bundle.routing.rules) {
    if (
        !modelCodes.has(rule.modelCode) ||
        !Array.isArray(rule.when) ||
        !rule.when.length ||
        !rule.reasonZh ||
        !rule.reasonEn
    ) {
        throw new Error(`Invalid routing rule for ${rule.modelCode ?? 'unknown model'}`);
    }
}
for (const required of bundle.schema.required) {
    if (!bundle.schema.properties[required]) throw new Error(`Missing schema property: ${required}`);
}
const schemaUseCases = [...bundle.schema.properties.useCase.enum].sort();
if (JSON.stringify(schemaUseCases) !== JSON.stringify(expectedUseCases)) {
    throw new Error('Prompt schema use cases do not match the compiled profiles');
}
process.stdout.write('image-prompt-pro bundle is valid\n');
