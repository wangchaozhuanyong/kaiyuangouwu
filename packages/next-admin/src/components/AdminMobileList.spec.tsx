// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminButton, AdminInput } from './AdminControls';
import { AdminMobileField, AdminMobileList, AdminMobileRecord, AdminMobileSort } from './AdminMobileList';

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function mount(children: React.ReactNode) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    await act(async () => root.render(children));
    cleanups.push(() => {
        root.unmount();
        element.remove();
    });
    return element;
}

describe('mobile record interaction adapters', () => {
    it('keeps selection separate from the detail action and renders missing values unchanged', async () => {
        const select = vi.fn();
        const open = vi.fn();
        const element = await mount(
            <AdminMobileList ariaLabel="商品">
                <AdminMobileRecord
                    title="超长商品名称"
                    status="启用"
                    selection={<AdminInput type="checkbox" aria-label="选择商品" onChange={select} />}
                    actions={
                        <AdminButton type="button" onClick={open}>
                            查看详情
                        </AdminButton>
                    }
                >
                    <AdminMobileField label="库存">读取失败</AdminMobileField>
                    <AdminMobileField label="价格">MYR 128.00</AdminMobileField>
                </AdminMobileRecord>
            </AdminMobileList>,
        );
        await act(async () =>
            element.querySelector<HTMLLabelElement>('.admin-mobile-record-selection')!.click(),
        );
        expect(select).toHaveBeenCalledOnce();
        expect(open).not.toHaveBeenCalled();
        await act(async () => element.querySelector<HTMLButtonElement>('button')!.click());
        expect(open).toHaveBeenCalledOnce();
        expect(element.querySelectorAll('[role="listitem"]')).toHaveLength(1);
        expect(element.querySelector('dd')?.textContent).toBe('读取失败');
    });

    it('passes the selected field and toggled direction to the existing sort owner once', async () => {
        const onSort = vi.fn();
        function Fixture() {
            const [sort, setSort] = useState<{ field: 'name' | 'updatedAt'; direction: 'ASC' | 'DESC' }>({
                field: 'name',
                direction: 'DESC',
            });
            return (
                <AdminMobileSort
                    fields={[
                        { value: 'name', label: '名称' },
                        { value: 'updatedAt', label: '更新时间' },
                    ]}
                    sortField={sort.field}
                    sortDirection={sort.direction}
                    onSort={(field, direction) => {
                        onSort(field, direction);
                        setSort({ field, direction });
                    }}
                />
            );
        }
        const element = await mount(<Fixture />);
        await act(async () => {
            const select = element.querySelector('select')!;
            select.value = 'updatedAt';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(onSort).toHaveBeenLastCalledWith('updatedAt', 'DESC');
        await act(async () => element.querySelector('button')!.click());
        expect(onSort).toHaveBeenLastCalledWith('updatedAt', 'ASC');
        expect(onSort).toHaveBeenCalledTimes(2);
        expect(element.querySelector('button')?.getAttribute('aria-label')).toContain('升序');
    });
});
