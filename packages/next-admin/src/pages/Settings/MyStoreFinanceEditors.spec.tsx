// @vitest-environment jsdom
import { getOperationAST, Kind } from 'graphql';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MY_STORE_SETTINGS_QUERY, type MyStoreSettingsResult } from '../../graphql/management.graphql';

import { MyStorePaymentOptions } from './MyStoreFinanceEditors';

vi.mock('@apollo/client/react', () => ({
    useMutation: () => [vi.fn(), { loading: false }],
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));

describe('merchant payment option identities', () => {
    it('reads the explicit handler code in the actual merchant settings query', () => {
        const operation = getOperationAST(MY_STORE_SETTINGS_QUERY);
        const optionField = operation?.selectionSet.selections.find(
            field => field.kind === Kind.FIELD && field.name.value === 'myStorePaymentOptions',
        );
        if (!optionField || optionField.kind !== Kind.FIELD)
            throw new Error('Merchant payment query is missing');
        expect(
            optionField.selectionSet?.selections.some(
                field => field.kind === Kind.FIELD && field.name.value === 'handlerCode',
            ),
        ).toBe(true);
    });

    it('keeps same named payment options and their switches distinct without inferring from the name', () => {
        const name = '提交订单后联系客服支付';
        const options: MyStoreSettingsResult['myStorePaymentOptions'] = [
            {
                id: 'legacy',
                code: 'controlled-test-payment-platform',
                name,
                handlerCode: 'controlled-test-payment-handler',
                platformEnabled: true,
                enabled: true,
                effectiveEnabled: true,
            },
            {
                id: 'formal',
                code: 'offline-manual-11',
                name,
                handlerCode: 'offline-manual-payment-handler',
                platformEnabled: true,
                enabled: false,
                effectiveEnabled: false,
            },
            {
                id: 'gateway',
                code: 'test-customer-support',
                name: '测试客服支付',
                handlerCode: 'stripe-payment-handler',
                platformEnabled: true,
                enabled: false,
                effectiveEnabled: false,
            },
        ];
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(
            <MyStorePaymentOptions
                options={options}
                onCompleted={() => Promise.resolve()}
                onError={() => undefined}
            />,
        );
        const rows = host.querySelectorAll('tbody tr');
        expect(rows).toHaveLength(3);
        expect(rows[0]?.textContent).toContain(`${name}模拟测试`);
        expect(rows[1]?.textContent).toContain(`${name}客服核款`);
        expect(rows[0]?.querySelector('input')?.checked).toBe(true);
        expect(rows[1]?.querySelector('input')?.checked).toBe(false);
        expect(rows[0]?.querySelector('input')?.getAttribute('aria-label')).toBe(
            `${name}（模拟测试）启用状态`,
        );
        expect(rows[1]?.querySelector('input')?.getAttribute('aria-label')).toBe(
            `${name}（客服核款）启用状态`,
        );
        expect(rows[2]?.querySelector('input')?.getAttribute('aria-label')).toBe('测试客服支付启用状态');
    });
});
