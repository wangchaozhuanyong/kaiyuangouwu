import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalStyles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const skeletonStyles = readFileSync(new URL('./styles/skeletons.css', import.meta.url), 'utf8');

describe('progressive loading styles', () => {
    it('shows a compact loading state instead of empty media-shaped skeletons', () => {
        expect(skeletonStyles).toContain('.page-loading-indicator');
        expect(skeletonStyles).not.toContain('.skeleton-hero');
    });

    it('keeps every image placeholder visible until the bitmap has decoded', () => {
        expect(globalStyles).toContain('.safe-image-frame.is-loaded > .safe-image-fallback');
        expect(globalStyles).not.toContain('.safe-image-frame.is-priority > .safe-image-fallback');
        expect(globalStyles).toMatch(/\.safe-image\s*\{[^}]*opacity:\s*0/u);
    });
});
