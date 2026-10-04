// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewsModule } from './ReviewsModule';

const mocks = vi.hoisted(() => ({
    enabled: true,
    canUpdate: true,
    update: vi.fn(),
    refetchSettings: vi.fn(),
    settingsQueryContext: undefined as unknown,
    settingMutationContext: undefined as unknown,
}));

vi.mock('@apollo/client/react', () => ({
    useQuery: (
        document: { definitions: Array<{ kind?: string; name?: { value: string } }> },
        options: { context?: unknown },
    ) => {
        const name = document.definitions.find(definition => definition.kind === 'OperationDefinition')?.name
            ?.value;
        if (name === 'GetAdminStorefrontReviewSettings') mocks.settingsQueryContext = options.context;
        return name === 'GetAdminStorefrontReviewSettings'
            ? {
                  data: { storefrontReviewSettings: { enabled: mocks.enabled } },
                  loading: false,
                  error: undefined,
                  refetch: mocks.refetchSettings,
              }
            : {
                  data: { storefrontReviews: { items: [], totalItems: 0, averageRating: 0 } },
                  loading: false,
                  error: undefined,
                  refetch: vi.fn(),
              };
    },
    useMutation: (
        document: { definitions: Array<{ kind?: string; name?: { value: string } }> },
        options: { context?: unknown },
    ) => {
        const name = document.definitions.find(definition => definition.kind === 'OperationDefinition')?.name
            ?.value;
        if (name === 'UpdateAdminStorefrontReviewSettings') mocks.settingMutationContext = options.context;
        return [name === 'UpdateAdminStorefrontReviewSettings' ? mocks.update : vi.fn(), { loading: false }];
    },
}));
vi.mock('../../hooks/use-url-tab', () => ({ useUrlTab: () => ['PENDING', vi.fn()] }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => mocks.canUpdate }),
}));
vi.mock('../../apollo', () => ({
    getActiveChannelToken: () => 'store-a',
    channelRequestContext: (token: string) => ({ headers: { 'vendure-token': token } }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.canUpdate = true;
    mocks.settingsQueryContext = undefined;
    mocks.settingMutationContext = undefined;
    mocks.update.mockResolvedValue({ data: { updateStorefrontReviewSettings: { enabled: false } } });
    mocks.refetchSettings.mockResolvedValue({ data: { storefrontReviewSettings: { enabled: false } } });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

describe('review feature switch', () => {
    it('saves the disabled setting and confirms the channel readback', async () => {
        await act(async () => root.render(<ReviewsModule />));
        const switchButton = host.querySelector<HTMLButtonElement>('[role="switch"]');
        expect(switchButton?.getAttribute('aria-checked')).toBe('true');
        await act(async () => switchButton?.click());
        expect(mocks.update).toHaveBeenCalledWith({ variables: { input: { enabled: false } } });
        expect(mocks.settingsQueryContext).toEqual({ headers: { 'vendure-token': 'store-a' } });
        expect(mocks.settingMutationContext).toEqual({ headers: { 'vendure-token': 'store-a' } });
        expect(mocks.refetchSettings).toHaveBeenCalledOnce();
        expect(host.textContent).toContain('客户端评价功能已关闭');
    });

    it('prevents a reader from changing the setting', async () => {
        mocks.canUpdate = false;
        await act(async () => root.render(<ReviewsModule />));
        expect(host.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
    });
});

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
