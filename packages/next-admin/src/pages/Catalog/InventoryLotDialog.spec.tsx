import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InventoryLotDialog } from './InventoryWarehouseModule';

describe('inventory batch dialog validation', () => {
    it.each(['请选择 SKU 并填写批次号', '库存批次保存失败，请检查输入后重试'])(
        'shows the error inside the active modal: %s',
        error => {
            const html = renderToStaticMarkup(
                <InventoryLotDialog
                    draft={{
                        productVariantId: '27',
                        stockLocationId: '7',
                        lotCode: '',
                        manufacturedAt: '',
                        expiresAt: '',
                        quantityOnHand: '0',
                        purchaseCost: '',
                    }}
                    variants={[]}
                    saving={false}
                    error={error}
                    onChange={vi.fn()}
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                />,
            );
            expect(html).toContain('role="dialog"');
            expect(html).toContain(`role="alert"`);
            expect(html).toContain(error);
            expect(html.indexOf(error)).toBeLessThan(html.indexOf('保存批次'));
        },
    );
});
