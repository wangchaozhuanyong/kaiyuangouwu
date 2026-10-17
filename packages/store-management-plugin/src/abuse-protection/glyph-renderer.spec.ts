import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { renderShopAbuseChallengeSvg, shopAbuseAlphabet } from './glyph-renderer';

function slotInk(data: Buffer, width: number, height: number): number[] {
    return Array.from({ length: 6 }, (_, slot) => {
        let count = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 16 + slot * 32; x < 48 + slot * 32; x++) {
                const pixel = (y * width + x) * 3;
                if (data[pixel] < 80 && data[pixel + 1] < 80 && data[pixel + 2] < 80) count++;
            }
        }
        return count;
    });
}

describe('font-independent security challenge glyphs', () => {
    it('rasterizes all 32 distinct glyphs with readable ink in every character slot', async () => {
        expect(shopAbuseAlphabet).toHaveLength(32);
        expect(new Set(shopAbuseAlphabet).size).toBe(32);
        const images = new Set<string>();
        for (const character of shopAbuseAlphabet) {
            const svg = renderShopAbuseChallengeSvg(character.repeat(6), () => 0);
            expect(svg).not.toMatch(/<text\b|font-|<(?:image|foreignObject)\b|href=/);
            const png = await sharp(Buffer.from(svg)).png().toBuffer();
            expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 232, height: 64 });
            const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
            expect(slotInk(data, info.width, info.height).every(count => count >= 64)).toBe(true);
            images.add(createHash('sha256').update(data).digest('hex'));
        }
        // Distinct source codes must also remain visually distinct after actual rasterization.
        expect(images.size).toBe(32);
    });

    it('retains visible glyphs inside every slot at both rotation and position extremes', async () => {
        for (const edge of ['minimum', 'maximum'] as const) {
            for (const character of shopAbuseAlphabet) {
                const svg = renderShopAbuseChallengeSvg(character.repeat(6), (min, max) =>
                    edge === 'minimum' ? min : max - 1,
                );
                const { data, info } = await sharp(Buffer.from(svg))
                    .removeAlpha()
                    .raw()
                    .toBuffer({ resolveWithObject: true });
                expect(slotInk(data, info.width, info.height).every(count => count >= 64)).toBe(true);
            }
        }
    });

    it('renders the compiled production helper in a fresh process without a font configuration', () => {
        const renderer = resolve(__dirname, '../../dist/abuse-protection/glyph-renderer.js');
        const script = `
            (async () => {
                const sharp = (await import('sharp')).default;
                const { renderShopAbuseChallengeSvg, shopAbuseAlphabet } = require(process.argv[1]);
                let minimumSlotInk = Infinity;
                for (const character of shopAbuseAlphabet) {
                    const svg = renderShopAbuseChallengeSvg(character.repeat(6));
                    const png = await sharp(Buffer.from(svg)).png().toBuffer();
                    const metadata = await sharp(png).metadata();
                    if (metadata.format !== 'png' || metadata.width !== 232 || metadata.height !== 64)
                        throw new Error('Invalid fontless raster');
                    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
                    for (let slot = 0; slot < 6; slot++) {
                        let ink = 0;
                        for (let y = 0; y < info.height; y++) {
                            for (let x = 16 + slot * 32; x < 48 + slot * 32; x++) {
                                const p = (y * info.width + x) * 3;
                                if (data[p] < 80 && data[p + 1] < 80 && data[p + 2] < 80) ink++;
                            }
                        }
                        minimumSlotInk = Math.min(minimumSlotInk, ink);
                    }
                }
                process.stdout.write(JSON.stringify({
                    count: shopAbuseAlphabet.length,
                    minimumSlotInk,
                    fontConfigFile: process.env.FONTCONFIG_FILE,
                    fontConfigPath: process.env.FONTCONFIG_PATH,
                }));
            })().catch(() => { process.stderr.write('Fontless glyph rendering failed'); process.exit(1); });
        `;
        const result = JSON.parse(
            execFileSync(process.execPath, ['-e', script, renderer], {
                env: { ...process.env, FONTCONFIG_FILE: '/dev/null', FONTCONFIG_PATH: '/nonexistent' },
                encoding: 'utf8',
                timeout: 30_000,
            }),
        );
        expect(result).toMatchObject({
            count: 32,
            fontConfigFile: '/dev/null',
            fontConfigPath: '/nonexistent',
        });
        expect(result.minimumSlotInk).toBeGreaterThanOrEqual(64);
    });

    it('rejects unsupported or incomplete glyph input before producing an image', () => {
        expect(() => renderShopAbuseChallengeSvg('')).toThrow('Invalid security glyph count');
        expect(() => renderShopAbuseChallengeSvg('000000')).toThrow('Unsupported security glyph');
    });
});
