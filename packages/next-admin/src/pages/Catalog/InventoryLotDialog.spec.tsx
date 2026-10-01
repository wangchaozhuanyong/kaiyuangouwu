// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryLotDialog, validateInventoryLotDraft } from './InventoryWarehouseModule';

const validDraft = {
    productVariantId: 'variant-1',
    stockLocationId: 'location-1',
    lotCode: 'LOT-001',
    manufacturedAt: '2026-09-01',
    expiresAt: '2027-09-01',
    quantityOnHand: '12',
    purchaseCost: '2.5',
    reason: '到货入库',
};

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(async () => {
    await act(async () => mounted.splice(0).forEach(({ unmount }) => unmount()));
});

function mountDialog(saving = false) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onClose = vi.fn();
    const onSave = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({
        container,
        unmount: () => {
            root.unmount();
            container.remove();
        },
    });
    act(() => {
        root.render(
            <InventoryLotDialog
                draft={validDraft}
                variants={[]}
                saving={saving}
                onChange={vi.fn()}
                onClose={onClose}
                onSave={onSave}
            />,
        );
    });
    return { container, onClose, onSave };
}

describe('inventory batch dialog validation', () => {
    const invalidDraftCases: [typeof validDraft, { variantId: string }[], string][] = [
        [{ ...validDraft, lotCode: '   ' }, [{ variantId: 'variant-1' }], '请选择 SKU 并填写批次号'],
        [
            { ...validDraft, productVariantId: 'missing' },
            [{ variantId: 'variant-1' }],
            '请选择 SKU 并填写批次号',
        ],
        [
            { ...validDraft, quantityOnHand: '' },
            [{ variantId: 'variant-1' }],
            '批次数量必须是不小于 0 的整数',
        ],
        [
            { ...validDraft, quantityOnHand: '-1' },
            [{ variantId: 'variant-1' }],
            '批次数量必须是不小于 0 的整数',
        ],
        [
            { ...validDraft, quantityOnHand: '1.5' },
            [{ variantId: 'variant-1' }],
            '批次数量必须是不小于 0 的整数',
        ],
        [{ ...validDraft, purchaseCost: '-0.1' }, [{ variantId: 'variant-1' }], '请输入有效的非负批次成本'],
        [
            { ...validDraft, purchaseCost: 'invalid' },
            [{ variantId: 'variant-1' }],
            '请输入有效的非负批次成本',
        ],
        [{ ...validDraft, reason: '  ' }, [{ variantId: 'variant-1' }], '请填写库存调整原因'],
    ];
    it.each(invalidDraftCases)(
        'rejects invalid input without allowing a save: %#',
        (draft, variants, message) => {
            expect(validateInventoryLotDraft(draft, variants)).toBe(message);
        },
    );

    it('accepts a valid batch with zero quantity and an omitted optional cost', () => {
        expect(
            validateInventoryLotDraft({ ...validDraft, quantityOnHand: '0', purchaseCost: '' }, [
                { variantId: 'variant-1' },
            ]),
        ).toBeUndefined();
    });

    it('cancel closes without saving and save dispatches once', () => {
        const { container, onClose, onSave } = mountDialog();
        const cancel = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === '取消',
        );
        const save = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === '保存批次',
        );
        expect(cancel).toBeTruthy();
        expect(save).toBeTruthy();
        act(() => cancel!.click());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSave).not.toHaveBeenCalled();
        act(() => save!.click());
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('locks both save and close while a batch mutation is pending', () => {
        const { container, onClose, onSave } = mountDialog(true);
        const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭批次编辑"]');
        const cancel = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === '取消',
        );
        const save = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === '保存中…',
        );
        expect(close?.disabled).toBe(true);
        expect(cancel?.disabled).toBe(true);
        expect(save?.disabled).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
        expect(onSave).not.toHaveBeenCalled();
    });

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
                        reason: '月底盘点',
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
