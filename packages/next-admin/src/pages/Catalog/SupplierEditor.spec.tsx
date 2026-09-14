import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SupplierEditor, validateSupplierDraft } from './SuppliersModule';

vi.mock('@apollo/client/react', () => ({ useMutation: () => [vi.fn(), { loading: false }] }));

describe('supplier editor feedback', () => {
    it.each(['供货商名称不能为空', '供货商编码已存在', '请输入有效的供货商邮箱'])(
        'shows validation or API feedback inside the modal: %s',
        error => {
            const html = renderToStaticMarkup(
                <SupplierEditor
                    value={{
                        name: '',
                        code: '',
                        enabled: true,
                        contactName: '',
                        phone: '',
                        email: '',
                        address: '',
                        notes: '',
                    }}
                    error={error}
                    onClose={vi.fn()}
                    onSaved={vi.fn()}
                    onError={vi.fn()}
                />,
            );
            expect(html).toContain('role="dialog"');
            expect(html).toContain('role="alert"');
            expect(html).toContain(error);
        },
    );
    it.each(['invalid', 'a@@example.test', 'a@example.testa@example.test', 'a b@example.test'])(
        'rejects an invalid optional email: %s',
        email => {
            expect(validateSupplierDraft({ name: '模拟供货商', email })).toBe('请输入有效的供货商邮箱');
        },
    );
    it.each(['', '  ', 'sim-supplier-0914@example.test', '  sim+supplier@example.test  '])(
        'accepts an empty or valid optional email: %s',
        email => {
            expect(validateSupplierDraft({ name: '模拟供货商', email })).toBe('');
        },
    );
    it('keeps the required name check', () => {
        expect(validateSupplierDraft({ name: ' ', email: '' })).toBe('供货商名称不能为空');
    });
});
