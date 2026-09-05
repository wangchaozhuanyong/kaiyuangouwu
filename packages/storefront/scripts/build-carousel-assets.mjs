import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const assetDirectory = path.resolve(
    scriptDirectory,
    '../src/assets/storefront/carousel/colorful-marketplace-v1',
);

const assets = [
    { key: 'token-topup', source: 'token-topup-source.png' },
    { key: 'codex-tiers', source: 'codex-tiers-source.png' },
    { key: 'account-services', source: 'account-services-source.png' },
];

const widths = [480, 960, 1440, 1600];

for (const asset of assets) {
    const source = path.join(assetDirectory, 'source', asset.source);
    const metadata = await sharp(source).metadata();
    assert.ok(metadata.width && metadata.height, `Cannot read image dimensions: ${source}`);
    assert.ok(metadata.width >= 1600, `Carousel source is too narrow: ${source}`);
    assert.ok(metadata.height >= 900, `Carousel source is too short: ${source}`);

    const normalized = sharp(source).resize(1600, 900, {
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
    });

    await normalized
        .clone()
        .png({ compressionLevel: 9, effort: 10 })
        .toFile(path.join(assetDirectory, `${asset.key}-v1.png`));

    for (const width of widths) {
        await normalized
            .clone()
            .resize(width, Math.round((width * 9) / 16), {
                fit: 'cover',
                position: 'centre',
                withoutEnlargement: true,
            })
            .webp({ quality: 88, effort: 6 })
            .toFile(path.join(assetDirectory, `${asset.key}-v1-${width}.webp`));
    }

    await normalized
        .clone()
        .resize(32, 18, { fit: 'cover', position: 'centre' })
        .blur(0.4)
        .webp({ quality: 56, effort: 6 })
        .toFile(path.join(assetDirectory, `${asset.key}-v1-32.webp`));
}

process.stdout.write(
    `${JSON.stringify({ ok: true, assets: assets.map(asset => asset.key), widths, master: '1600x900' }, null, 2)}\n`,
);
