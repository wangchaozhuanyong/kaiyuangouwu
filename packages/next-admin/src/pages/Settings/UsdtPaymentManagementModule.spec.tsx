import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsdtPaymentManagementModule } from './UsdtPaymentManagementModule';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);

describe('UsdtPaymentManagementModule', () => {
    beforeEach(() => {
        apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useQuery.mockReturnValue({
            data: undefined,
            error: undefined,
            loading: true,
            refetch: vi.fn(),
        });
    });

    it('uses the shared full-width loading frame', () => {
        const html = renderToStaticMarkup(<UsdtPaymentManagementModule />);

        expect(html.match(/max-w-none/g)).toHaveLength(2);
        expect(html).not.toContain('max-w-[1500px]');
        expect(html).toContain('aria-label="正在读取平台支付数据"');
        expect(html).toContain('min-h-[620px]');
    });
});
