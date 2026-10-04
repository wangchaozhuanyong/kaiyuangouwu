import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GenericPromotionDetailData } from '../../graphql/generic-promotions.graphql';

import { PromotionEditor } from './GenericPromotionsPanel';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);

const promotion: NonNullable<GenericPromotionDetailData['promotion']> = {
    id: 'promotion-1',
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    name: '测试促销',
    description: '回归测试',
    enabled: true,
    couponCode: 'TEST',
    startsAt: null,
    endsAt: null,
    usageLimit: 100,
    perCustomerUsageLimit: 1,
    conditions: [],
    actions: [],
    translations: [],
};

describe('PromotionEditor', () => {
    beforeEach(() => {
        apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useQuery.mockReturnValue({
            data: { promotion },
            error: undefined,
            loading: false,
            refetch: vi.fn(),
        });
    });

    it('keeps a stable shell while the first detail read is pending', () => {
        apolloMocks.useQuery.mockReturnValue({ data: undefined, loading: true, refetch: vi.fn() });
        const html = renderToStaticMarkup(
            <PromotionEditor
                id={promotion.id}
                conditions={[]}
                actions={[]}
                languageCode="zh_CN"
                onClose={() => undefined}
                onSaved={async () => undefined}
                onError={() => undefined}
            />,
        );

        expect(html).toContain('h-[94vh]');
        expect(html).toContain('max-h-[64rem]');
        expect(html).toContain('正在读取促销规则…');
        expect(html).not.toContain('测试促销');
    });
    it('keeps loaded fields visible during background refresh', () => {
        apolloMocks.useQuery.mockReturnValue({ data: { promotion }, loading: true, refetch: vi.fn() });
        const html = renderToStaticMarkup(
            <PromotionEditor
                id={promotion.id}
                conditions={[]}
                actions={[]}
                languageCode="zh_CN"
                onClose={() => undefined}
                onSaved={async () => undefined}
                onError={() => undefined}
            />,
        );
        expect(html).toContain('value="TEST"');
        expect(html).not.toContain('正在读取促销规则…');
    });
});

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
