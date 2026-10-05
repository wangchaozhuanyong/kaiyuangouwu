// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { CustomersModule } from './CustomersModule';

// Business data is local; shared Apollo lifecycle is covered by its existing runtime tests.
const mocks = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), refetch: vi.fn() }));
vi.mock('../../hooks/use-admin-query', () => ({ useAdminQuery: mocks.query }));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutate, { loading: false }] }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const response = {
    activeChannel: { id: 'feedback-channel', code: '__default_channel__' },
    customers: { totalItems: 0, items: [] },
    customerGroup: { customers: { totalItems: 0, items: [] } },
    customerGroups: { totalItems: 0, items: [] },
    customer: null,
    open: { totalItems: 0 },
    overdue: { totalItems: 0 },
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
    sessionStorage.clear();
    mocks.query.mockReset().mockReturnValue({ data: response, loading: false, refetch: mocks.refetch });
    mocks.mutate.mockReset();
    mocks.refetch.mockReset().mockResolvedValue({ data: response });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

function button(label: string, within: ParentNode = host) {
    const result = [...within.querySelectorAll<HTMLButtonElement>('button')].find(
        item => item.textContent?.trim() === label,
    );
    expect(result, label).toBeDefined();
    return result!;
}

function createDialog() {
    return [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
        dialog => dialog.querySelector('h2')?.textContent?.trim() === '新建客户',
    );
}

function input(dialog: HTMLElement, label: string) {
    const field = [...dialog.querySelectorAll<HTMLLabelElement>('label')].find(
        item => item.textContent?.trim() === label,
    );
    expect(field, label).toBeDefined();
    const control = field!.querySelector<HTMLInputElement>('input');
    expect(control, label).not.toBeNull();
    return control!;
}

async function fill(dialog: HTMLElement, label: string, value: string) {
    await act(async () => {
        const control = input(dialog, label);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(control, value);
        control.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function openValidDraft() {
    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={['/customers/list']}>
                <AdminPermissionsContext.Provider
                    value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                >
                    <ConfirmDialogContext.Provider value={async () => false}>
                        <FeatureHelpProvider>
                            <CustomersModule />
                        </FeatureHelpProvider>
                    </ConfirmDialogContext.Provider>
                </AdminPermissionsContext.Provider>
            </MemoryRouter>,
        ),
    );
    await act(async () => button('新建客户').click());
    const dialog = createDialog()!;
    expect(dialog).toBeDefined();
    expect(host.contains(dialog)).toBe(false);
    await fill(dialog, '姓', '反馈');
    await fill(dialog, '名', '客户');
    await fill(dialog, '邮箱 *', 'feedback@example.invalid');
    expect(button('保存资料', dialog).disabled).toBe(false);
    return dialog;
}

describe('customer creation failure feedback', () => {
    it('shows a rejected creation inside the open dialog and retains the entered draft', async () => {
        mocks.mutate.mockRejectedValue(new Error('该邮箱已存在'));
        const dialog = await openValidDraft();

        await act(async () => button('保存资料', dialog).click());

        expect(mocks.mutate).toHaveBeenCalledTimes(1);
        expect(mocks.mutate).toHaveBeenCalledWith({
            variables: {
                input: {
                    title: null,
                    firstName: '客户',
                    lastName: '反馈',
                    emailAddress: 'feedback@example.invalid',
                    phoneNumber: null,
                },
            },
        });
        expect(createDialog()).toBe(dialog);
        expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('保存失败');
        expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('该邮箱已存在');
        expect(input(dialog, '姓').value).toBe('反馈');
        expect(input(dialog, '名').value).toBe('客户');
        expect(input(dialog, '邮箱 *').value).toBe('feedback@example.invalid');
        expect(mocks.refetch).not.toHaveBeenCalled();
        expect(host.textContent).not.toContain('客户已创建');
        await act(async () => button('取消', dialog).click());
        expect(createDialog()).toBeUndefined();
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
    });

    it('reports failed readback after accepted creation without replaying the write', async () => {
        mocks.mutate.mockResolvedValue({
            data: { createCustomer: { __typename: 'Customer', id: 'feedback-created-customer' } },
        });
        mocks.refetch.mockRejectedValue(new Error('模拟最新列表读取失败'));
        const dialog = await openValidDraft();

        await act(async () => button('保存资料', dialog).click());

        expect(mocks.mutate).toHaveBeenCalledTimes(1);
        expect(createDialog()).toBeUndefined();
        expect(host.textContent).toContain('客户已创建');
        expect(host.textContent).toContain('操作已完成，但最新数据读取失败');
        expect(host.textContent).toContain('勿重复提交');
        expect(host.textContent).not.toContain('保存失败');
        expect(mocks.refetch).toHaveBeenCalledTimes(3);
        mocks.refetch.mockResolvedValue({ data: response });
        await act(async () => button('刷新').click());
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
        expect(mocks.refetch).toHaveBeenCalledTimes(6);
    });
});
