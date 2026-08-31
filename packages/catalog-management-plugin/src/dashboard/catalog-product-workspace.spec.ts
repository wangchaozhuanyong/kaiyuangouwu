import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('catalog product workspace', () => {
    it('keeps SKU creation inside the workspace sheet', () => {
        const source = readFileSync(
            path.resolve(process.cwd(), 'src/dashboard/catalog-product-workspace.tsx'),
            'utf8',
        );

        expect(source).toContain('createCatalogProductVariantMutation');
        expect(source).toContain('<NewVariantEditor');
        expect(source).toContain('const [newVariantOpen, setNewVariantOpen] = useState(false);');
        expect(source).toContain('onOpenChange={nextOpen => !nextOpen && onClose()}');
        expect(source).toContain('保留草稿，重新打开可以继续填写');
        expect(source).toContain('sm:flex-row sm:justify-end');
        expect(source).toContain('sm:max-w-[640px]');
        expect(source).toContain('catalog-product-option-validation');
        expect(source).not.toContain('to="./variants"');
    });
});
