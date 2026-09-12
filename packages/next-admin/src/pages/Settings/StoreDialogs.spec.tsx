// @vitest-environment jsdom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { ConfirmDialogContext, type RequestConfirmation } from '../../components/confirm-dialog-context';
import type {
    StoreDeprovisionImpactRecord,
    StoreManagementResult,
    StoreProfileRecord,
} from '../../graphql/management.graphql';
import {
    DEPROVISION_STORE_MUTATION,
    SUSPEND_STORE_MUTATION,
    UPDATE_STORE_PROFILE_MUTATION,
} from '../../graphql/management.graphql';
import { ProvisionStoreDialog, StoreDeprovisionDialog, StoreEditor } from './StoreDialogs';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
    useApolloClient: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);

describe('StoreEditor seller binding', () => {
    const sellers = [
        { id: 'seller-1', name: '大马仓库' },
        { id: 'seller-2', name: '模钥科技' },
    ];
    const profile: StoreProfileRecord = {
        id: 'profile-1',
        updatedAt: '2026-09-12T00:00:00.000Z',
        status: 'ACTIVE',
        sortOrder: 0,
        descriptionZh: '简介',
        descriptionEn: 'Description',
        taglineZh: null,
        taglineEn: null,
        brandBackgroundColor: null,
        brandPrimaryColor: null,
        brandAccentColor: null,
        brandHighlightColor: null,
        legalEntityName: null,
        legalRegistrationCountry: null,
        supportEmail: null,
        privacyEmail: null,
        internalNote: null,
        primaryDomain: null,
        storefrontUrl: null,
        isOperational: true,
        activationReadiness: { ready: true, checks: [] },
        logoAsset: null,
        logoOnLightAsset: null,
        logoOnDarkAsset: null,
        channel: {
            id: 'channel-1',
            code: '__default_channel__',
            token: 'test-store-channel',
            defaultCurrencyCode: 'MYR',
            defaultLanguageCode: 'zh_Hans',
            seller: sellers[0],
            customFields: { storefrontNameZh: '模钥店铺', storefrontNameEn: 'Moyao' },
        },
    };
    let container: HTMLDivElement;
    let root: Root;
    const requestConfirmation = vi.fn<RequestConfirmation>();
    const mutate = vi.fn();
    const onCompleted = vi.fn();
    const onError = vi.fn();
    const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

    beforeEach(() => {
        environment.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        requestConfirmation.mockReset().mockResolvedValue({ currentPassword: 'test-password' });
        mutate.mockReset().mockResolvedValue({ data: { updateStoreProfile: profile } });
        onCompleted.mockReset().mockResolvedValue(undefined);
        onError.mockReset();
        apolloMocks.useApolloClient.mockReturnValue({ mutate });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        environment.IS_REACT_ACT_ENVIRONMENT = false;
    });

    async function renderEditor(ready = true) {
        await act(async () =>
            root.render(
                <FeatureHelpProvider>
                    <ConfirmDialogContext.Provider value={requestConfirmation}>
                        <StoreEditor
                            profile={profile}
                            sellers={ready ? sellers : []}
                            sellerOptionsReady={ready}
                            onClose={() => undefined}
                            onCompleted={onCompleted}
                            onError={onError}
                        />
                    </ConfirmDialogContext.Provider>
                </FeatureHelpProvider>,
            ),
        );
    }

    function sellerSelect() {
        return container.querySelector<HTMLSelectElement>('select[aria-label="所属商家主体（店铺归属）"]')!;
    }

    async function selectSellerAndSave() {
        await act(async () => {
            sellerSelect().value = 'seller-2';
            sellerSelect().dispatchEvent(new Event('change', { bubbles: true }));
        });
        await save();
    }

    async function save() {
        await act(async () =>
            Array.from(container.querySelectorAll('button'))
                .find(button => button.textContent === '保存店铺档案')!
                .click(),
        );
    }

    it('shows the real seller with empty legal text and submits the rebind once with the profile version', async () => {
        await renderEditor();
        expect(sellerSelect().value).toBe('seller-1');
        expect(
            container.querySelector<HTMLInputElement>('input[placeholder="营业执照或注册文件上的完整名称"]')!
                .value,
        ).toBe('');
        await selectSellerAndSave();
        expect(requestConfirmation).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                title: '确认变更店铺归属？',
                requireCurrentPassword: true,
                description: expect.stringContaining('从“大马仓库”改为“模钥科技”'),
            }),
        );
        expect(mutate).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                mutation: UPDATE_STORE_PROFILE_MUTATION,
                variables: {
                    input: expect.objectContaining({
                        id: profile.id,
                        expectedUpdatedAt: profile.updatedAt,
                        sellerId: 'seller-2',
                        currentPassword: 'test-password',
                        legalEntityName: null,
                    }),
                },
                context: expect.objectContaining({
                    headers: expect.objectContaining({ 'vendure-token': 'test-store-channel' }),
                }),
            }),
        );
        expect(onCompleted).toHaveBeenCalledWith('店铺归属和档案已保存');
    });

    it('does not submit or report success when the administrator cancels confirmation', async () => {
        requestConfirmation.mockResolvedValue(false);
        await renderEditor();
        await selectSellerAndSave();
        expect(mutate).not.toHaveBeenCalled();
        expect(onCompleted).not.toHaveBeenCalled();
    });

    it('does not change ownership or ask for a password when editing only legal text', async () => {
        await renderEditor();
        await act(async () =>
            setInputValue(
                container.querySelector<HTMLInputElement>(
                    'input[placeholder="营业执照或注册文件上的完整名称"]',
                )!,
                '注册公司全称',
            ),
        );
        await save();
        expect(requestConfirmation).not.toHaveBeenCalled();
        const input = mutate.mock.calls[0][0].variables.input;
        expect(input.legalEntityName).toBe('注册公司全称');
        expect(input).not.toHaveProperty('sellerId');
        expect(input).not.toHaveProperty('currentPassword');
    });

    it('keeps the editor open and shows a backend refusal without reporting success', async () => {
        mutate.mockRejectedValue(new Error('所选商家主体已不存在，请刷新后重新选择'));
        await renderEditor();
        await selectSellerAndSave();
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('所选商家主体已不存在');
        expect(onCompleted).not.toHaveBeenCalled();
    });

    it('preserves the current binding but disables rebinding while the seller list is incomplete', async () => {
        await renderEditor(false);
        expect(sellerSelect().disabled).toBe(true);
        expect(sellerSelect().value).toBe('seller-1');
        expect(sellerSelect().textContent).toContain('大马仓库（当前绑定）');
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('商家列表尚未加载完整');
    });
});

describe('ProvisionStoreDialog', () => {
    beforeEach(() => {
        apolloMocks.useMutation.mockReset();
        apolloMocks.useQuery.mockReset();
        apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
    });

    it('lets the platform administrator select any existing store as the configuration source', () => {
        const stores: StoreManagementResult['storeProvisioningTemplates'] = [
            {
                id: 'default-channel',
                code: '__default_channel__',
                defaultLanguageCode: 'zh_Hans',
                defaultCurrencyCode: 'CNY',
            },
            {
                id: 'malaysia-store',
                code: '美宜佳',
                defaultLanguageCode: 'zh_Hans',
                defaultCurrencyCode: 'MYR',
            },
        ];

        const html = renderToStaticMarkup(
            <ProvisionStoreDialog
                templates={stores}
                onClose={() => undefined}
                onCompleted={async () => undefined}
                onError={() => undefined}
            />,
        );

        expect(html).toContain('选择基础店铺');
        expect(html).toContain('默认店铺 · zh_Hans / CNY');
        expect(html).toContain('美宜佳 · zh_Hans / MYR');
        expect(html).toContain('新店会复制所选店铺的语言、币种、税务和库存默认值');
        expect(html).not.toContain('需要先在后端 Channel 配置中启用开店模板');
    });

    it('executes store deprovisioning from the password dialog without opening another confirmation', async () => {
        const reactTestEnvironment = globalThis as typeof globalThis & {
            IS_REACT_ACT_ENVIRONMENT: boolean;
        };
        reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        const deprovision = vi.fn().mockResolvedValue({
            data: {
                deprovisionStore: {
                    channelId: 'channel-1',
                    channelCode: 'store-a',
                    deletedAdministratorCount: 1,
                    deletedRole: true,
                    deletedSeller: false,
                },
            },
        });
        const impact: StoreDeprovisionImpactRecord = {
            profileId: 'profile-1',
            channelId: 'channel-1',
            channelCode: 'store-a',
            status: 'SUSPENDED',
            isDefaultChannel: false,
            isProvisioningTemplate: false,
            isActiveChannel: false,
            orderCount: 0,
            productCount: 0,
            customerCount: 0,
            administratorCount: 1,
            domainCount: 0,
            extensionRecordCount: 0,
            sellerWillBeDeleted: false,
            roleWillBeDeleted: true,
            blockers: [],
            canDeprovision: true,
        };
        const profile = {
            id: 'profile-1',
            updatedAt: '2026-09-01T00:00:00.000Z',
            channel: { id: 'channel-1', code: 'store-a', customFields: {} },
        } as StoreProfileRecord;
        apolloMocks.useQuery.mockReturnValue({
            data: { storeDeprovisionImpact: impact },
            loading: false,
            error: undefined,
            refetch: vi.fn().mockResolvedValue({ data: { storeDeprovisionImpact: impact } }),
        });
        apolloMocks.useMutation.mockImplementation(document => {
            if (document === SUSPEND_STORE_MUTATION) return [vi.fn(), { loading: false }];
            if (document === DEPROVISION_STORE_MUTATION) return [deprovision, { loading: false }];
            return [vi.fn(), { loading: false }];
        });

        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(
                <StoreDeprovisionDialog
                    profile={profile}
                    onClose={() => undefined}
                    onCompleted={async () => undefined}
                    onError={() => undefined}
                />,
            );
        });

        const passwordInput = container.querySelector<HTMLInputElement>('input[type="password"]')!;
        const codeInput = container.querySelector<HTMLInputElement>('input[placeholder="store-a"]')!;
        const submitButton = Array.from(container.querySelectorAll('button')).find(button =>
            button.textContent?.includes('验证并彻底清退'),
        )!;
        expect(submitButton.disabled).toBe(true);

        await act(async () => {
            setInputValue(passwordInput, 'secret');
            setInputValue(codeInput, 'store-a');
        });
        expect(submitButton.disabled).toBe(false);

        await act(async () => {
            submitButton.click();
        });
        expect(deprovision).toHaveBeenCalledWith({
            variables: {
                input: {
                    profileId: 'profile-1',
                    expectedUpdatedAt: '2026-09-01T00:00:00.000Z',
                    currentPassword: 'secret',
                    confirmCode: 'store-a',
                },
            },
        });
        expect(container.textContent).not.toContain('最后确认');

        await act(async () => root.unmount());
        container.remove();
        reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    });
});

function renderToStaticMarkup(element: ReactElement) {
    return renderMarkup(<FeatureHelpProvider>{element}</FeatureHelpProvider>);
}

function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}
