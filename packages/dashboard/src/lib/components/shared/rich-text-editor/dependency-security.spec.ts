import { mergeAttributes } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

describe('rich-text dependency security', () => {
    // GHSA-cp6q-959q-f8rh
    it('does not turn JSON prototype data into executable DOM attributes', () => {
        const importedAttributes = JSON.parse('{"__proto__":{"src":"invalid://image","onerror":"alert(1)"}}');
        const attributes = mergeAttributes({ class: 'rich-text-image' }, importedAttributes);
        const { dom } = DOMSerializer.renderSpec(document, ['img', attributes]);
        const image = dom as HTMLImageElement;

        expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
        expect(image.className).toBe('rich-text-image');
        expect(image.hasAttribute('onerror')).toBe(false);
        expect(image.hasAttribute('src')).toBe(false);
        expect(Object.prototype).not.toHaveProperty('onerror');
    });

    it('still merges normal editor classes, styles and asset attributes', () => {
        const attributes = mergeAttributes(
            { class: 'rich-text-image', style: 'width: 100px; color: red' },
            { class: 'selected', style: 'color: blue', src: '/assets/example.webp' },
        );
        const { dom } = DOMSerializer.renderSpec(document, ['img', attributes]);
        const image = dom as HTMLImageElement;

        expect(image.classList.contains('rich-text-image')).toBe(true);
        expect(image.classList.contains('selected')).toBe(true);
        expect(image.style.width).toBe('100px');
        expect(image.style.color).toBe('blue');
        expect(image.getAttribute('src')).toBe('/assets/example.webp');
    });
});
