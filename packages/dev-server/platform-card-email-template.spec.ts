import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { HandlebarsMjmlGenerator } from '../email-plugin/src/generator/handlebars-mjml-generator';
import { FileBasedTemplateLoader } from '../email-plugin/src/template-loader/file-based-template-loader';

describe('selling-store card delivery email', () => {
    it.each([true, false])(
        'renders the selling store brand, order link and two credentials (Chinese=%s)',
        async isChinese => {
            const loader = new FileBasedTemplateLoader(path.join(import.meta.dirname, 'email-templates'));
            const generator = new HandlebarsMjmlGenerator();
            await generator.onInit({ templateLoader: loader } as never);
            const template = await loader.loadTemplate({} as never, {} as never, {
                type: 'auto-card-delivery',
                templateName: 'body.hbs',
            });
            const result = await generator.generate(
                'Synthetic Store <test@example.invalid>',
                'Delivery',
                template,
                {
                    isChinese,
                    emailLanguage: isChinese ? 'zh' : 'en',
                    brandName: 'Selling Store B',
                    storefrontUrl: 'https://seller-b.example.invalid',
                    orderCode: 'SYNTHETIC-B-ORDER',
                    productName: 'Synthetic Card',
                    sku: 'SYNTHETIC-B-SKU',
                    credentials: [
                        { number: 1, rawPayload: 'SYNTHETIC-CARD-ONE' },
                        { number: 2, rawPayload: 'SYNTHETIC-CARD-TWO' },
                    ],
                },
            );
            expect(result.body).toContain('Selling Store B');
            expect(result.body).toContain('https://seller-b.example.invalid/orders');
            expect(result.body).toContain('SYNTHETIC-B-ORDER');
            expect(result.body).toContain('SYNTHETIC-CARD-ONE');
            expect(result.body).toContain('SYNTHETIC-CARD-TWO');
            expect(result.body).not.toContain('/account/orders/');
            expect(result.body).toContain(isChinese ? '第 2 份' : 'Item 2');
        },
    );
});
