import { describe, expect, it } from 'vitest';
import {
    fulfillmentStateDisplayLabel,
    getLocalizedInterfaceCopy,
    getLocalizedMetadata,
    getSystemLabel,
    localizedDisplayFields,
    orderStateDisplayLabel,
    serviceMessageDisplay,
} from '../../../common/src/display-localization';
import {
    departmentDisplayLabel,
    eventTypeDisplayLabel,
    paymentMethodDisplayLabel,
    systemFieldDisplayLabel,
} from '../../../common/src/system-display-labels';
import { storefrontClientPluginCatalog } from '../../../storefront-content-plugin/src/client-plugin-manifest';
import { getClientPluginDisplay } from '../../../storefront-content-plugin/src/shared/client-plugin-display';

describe('shared display language contract', () => {
    it.each(['NEW_SERVER_ENUM', '', 'constructor', '__proto__', 'toString'])(
        'never renders unknown or inherited system keys: %s',
        value => {
            expect(getSystemLabel(value, { ACTIVE: '已启用' })).toBe('未知状态');
            expect(getSystemLabel(value, {}, 'en')).toBe('Unknown status');
            expect(getSystemLabel('ACTIVE', { ACTIVE: 'English only' }, 'zh')).toBe('未知状态');
            expect(orderStateDisplayLabel(value, 'zh')).toBe('未知状态');
            expect(fulfillmentStateDisplayLabel(value, 'en')).toBe('Unknown status');
        },
    );
    it('uses one order dictionary for every storefront order and payment surface', () => {
        expect(orderStateDisplayLabel('TestPaymentSettled', 'zh')).toBe('测试已付款');
        expect(orderStateDisplayLabel('PaymentSettled', 'en')).toBe('Preparing shipment');
    });
    it('never borrows metadata from another language', () => {
        expect(getLocalizedMetadata({ en: 'English only' }, 'zh')).toBe('未填写中文名称');
        expect(getLocalizedInterfaceCopy({ zh: 'Incorrect English label' }, 'zh', 'plugin')).toBe(
            '未登记插件',
        );
        expect(getLocalizedMetadata({ zh: '仅中文' }, 'en')).toBe('English name not set');
        expect(
            localizedDisplayFields(
                [{ languageCode: 'en', name: 'English name', description: 'English copy' }],
                'zh_Hans',
                ['name', 'description'],
            ),
        ).toEqual({ name: '未填写中文名称', description: '' });
    });
    it('resolves all published plugins and safely handles plugins from newer versions', () => {
        for (const plugin of storefrontClientPluginCatalog) {
            expect(getClientPluginDisplay(plugin.code, 'zh').name).toBe(plugin.name);
            expect(getClientPluginDisplay(plugin.code, 'en').name).toBe(plugin.englishName);
        }
        expect(getClientPluginDisplay('future-plugin-internal-key', 'zh').name).toBe('未登记插件');
        expect(getClientPluginDisplay('future-plugin-internal-key', 'en').name).toBe('Unregistered plugin');
    });
    it('localizes operational metadata while preserving already localized service stages', () => {
        expect(departmentDisplayLabel('DATA_FINANCE')).toBe('数据财务与经营分析部');
        expect(eventTypeDisplayLabel('commerce.payment.settled')).toBe('支付成功');
        expect(systemFieldDisplayLabel('stage', '选择 Key')).toBe('选择密钥');
        expect(systemFieldDisplayLabel('stage', '结果保存')).toBe('结果保存');
        expect(systemFieldDisplayLabel('stage', 'FUTURE_STAGE')).toBe('未识别类型');
        expect(systemFieldDisplayLabel('matchingStatus', 'CROSS_MATCH_REVIEWED')).toBe('交叉匹配已审');
        expect(systemFieldDisplayLabel('costSource', 'FUTURE_COST_SOURCE')).toBe('未识别类型');
        expect(paymentMethodDisplayLabel('future-payment-internal-code')).toBe('其他支付方式');
        expect(paymentMethodDisplayLabel('constructor')).toBe('其他支付方式');
    });
    it('does not expose English diagnostics or secrets on Chinese screens', () => {
        expect(serviceMessageDisplay('Connection timed out')).toBe('服务暂时不可用，请稍后重试');
        expect(serviceMessageDisplay('余额不足，请充值')).toBe('余额不足，请充值');
        expect(serviceMessageDisplay('token=private，连接失败')).toBe('服务暂时不可用，请稍后重试');
        expect(serviceMessageDisplay(null)).toBeNull();
        expect(serviceMessageDisplay(undefined)).toBeUndefined();
        expect(serviceMessageDisplay('', 'en')).toBe('');
    });
});
