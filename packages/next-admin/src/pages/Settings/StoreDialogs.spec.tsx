// @vitest-environment jsdom

import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import type {
    StoreDeprovisionImpactRecord,
    StoreManagementResult,
    StoreProfileRecord,
} from '../../graphql/management.graphql';
import { DEPROVISION_STORE_MUTATION, SUSPEND_STORE_MUTATION } from '../../graphql/management.graphql';
import { ProvisionStoreDialog, StoreDeprovisionDialog } from './StoreDialogs';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);

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
