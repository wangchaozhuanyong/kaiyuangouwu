import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalStyles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const skeletonStyles = readFileSync(new URL('./styles/skeletons.css', import.meta.url), 'utf8');

describe('progressive loading styles', () => {
    it('shows a compact loading state instead of empty media-shaped skeletons', () => {
        expect(skeletonStyles).toContain('.page-loading-indicator');
        expect(skeletonStyles).not.toContain('.skeleton-hero');
    });

    it('keeps native SSR images visible and removes fallback only after the node has pixels', () => {
        expect(globalStyles).toMatch(/\.safe-image\s*\{[^}]*opacity:\s*1/u);
        expect(globalStyles).toMatch(
            /\.safe-image-frame\.is-painted > \.safe-image-fallback\s*\{[^}]*opacity:\s*0/u,
        );
        expect(globalStyles).not.toContain('.safe-image-frame.is-priority > .safe-image-fallback');
        expect(globalStyles).not.toMatch(/\.safe-image\s*\{[^}]*opacity:\s*0/u);
        expect(globalStyles).toMatch(
            /\.safe-image-fallback\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*background-repeat:\s*no-repeat/u,
        );
    });
});
