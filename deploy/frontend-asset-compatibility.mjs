import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    constants,
    copyFileSync,
    existsSync,
    linkSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FRONTEND_ASSET_WINDOW_MS = 7 * 86400_000;
const manifestName = '.asset-compatibility.json';
const hashedAsset = /^[\w.-]+-[A-Za-z0-9_-]{8}\.(?:css|js|webp|png|jpe?g|svg|avif|ico|woff2?)$/u;
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function assets(root, compatibility = false) {
    const parent = compatibility ? resolve(root, '.compat-assets') : root;
    if (!existsSync(parent)) return [];
    assert(
        lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink(),
        'Build asset parent must be a real directory',
    );
    const directory = resolve(parent, 'assets');
    if (!existsSync(directory)) return [];
    assert(
        lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(),
        'Build assets must be a real directory',
    );
    return readdirSync(directory)
        .filter(name => hashedAsset.test(name))
        .map(name => {
            const file = resolve(directory, name);
            assert(
                lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(),
                'Build asset must be a regular file',
            );
            return { name, file };
        });
}
function manifest(root) {
    const file = resolve(root, manifestName);
    const value = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, assets: {} };
    assert.equal(value.version, 1, 'Unknown compatibility manifest');
    assert(
        value.assets && typeof value.assets === 'object' && !Array.isArray(value.assets),
        'Invalid compatibility entries',
    );
    return value.assets;
}
/** Only immutable generated files are retained. Native assets/ stays exactly this build's, so SSR cannot discover old CSS. */
export function preserveFrontendAssets(previous, candidate, now = Date.now()) {
    if (!previous || resolve(previous) === resolve(candidate)) return { retained: 0 };
    const native = new Map(assets(candidate).map(asset => [asset.name, asset.file]));
    const inherited = manifest(previous);
    const entries = manifest(candidate);
    // Validate a retried candidate without renewing any previously assigned deadline.
    for (const { name, file } of assets(candidate, true)) {
        assert(
            entries[name] && Number.isFinite(entries[name].expiresAt),
            'Missing candidate compatibility deadline',
        );
        assert.equal(digest(file), entries[name].sha256, 'Candidate immutable asset changed');
    }
    const sources = [
        ...assets(previous).map(asset => ({ ...asset, expiresAt: now + FRONTEND_ASSET_WINDOW_MS })),
        ...assets(previous, true).map(asset => {
            const record = inherited[asset.name];
            assert(record && Number.isFinite(record.expiresAt), 'Missing inherited compatibility deadline');
            assert.equal(digest(asset.file), record.sha256, 'Previous immutable asset changed');
            return { ...asset, expiresAt: Math.min(record.expiresAt, now + FRONTEND_ASSET_WINDOW_MS) };
        }),
    ];
    let retained = 0;
    for (const { name, file, expiresAt } of sources) {
        if (expiresAt <= now) continue;
        const sha256 = digest(file);
        if (native.has(name)) {
            assert.equal(digest(native.get(name)), sha256, 'Content-hashed filename collision');
            continue;
        }
        const target = resolve(candidate, '.compat-assets/assets', name);
        if (existsSync(target)) assert.equal(digest(target), sha256, 'Content-hashed filename collision');
        else {
            mkdirSync(resolve(candidate, '.compat-assets/assets'), { recursive: true });
            try {
                linkSync(file, target);
            } catch (error) {
                if (error.code !== 'EXDEV') throw error;
                copyFileSync(file, target, constants.COPYFILE_EXCL);
            }
            retained++;
        }
        entries[name] ??= { expiresAt, sha256 };
    }
    writeFileSync(resolve(candidate, manifestName), JSON.stringify({ version: 1, assets: entries }) + '\n');
    return { retained, windowMs: FRONTEND_ASSET_WINDOW_MS };
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const [candidate, pointer] = process.argv.slice(2);
    const { realpathSync } = await import('node:fs');
    process.stdout.write(
        JSON.stringify(
            preserveFrontendAssets(existsSync(pointer) ? realpathSync(pointer) : null, candidate),
        ) + '\n',
    );
}
