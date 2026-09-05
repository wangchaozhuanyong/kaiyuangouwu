import type { ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import type { StoreManagementResult } from '../../graphql/management.graphql';
import { ProvisionStoreDialog } from './StoreDialogs';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);

describe('ProvisionStoreDialog', () => {
    beforeEach(() => {
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
});

function renderToStaticMarkup(element: ReactElement) {
    return renderMarkup(<FeatureHelpProvider>{element}</FeatureHelpProvider>);
}
