import { setupI18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';

import { getBulkActionEntityLabel } from './bulk-action-entity-labels.js';

describe('getBulkActionEntityLabel', () => {
    const i18n = setupI18n({
        locale: 'zh_Hans',
        messages: {
            zh_Hans: {
                'Deleted {deleted} {entityName}': '{entityName}已删除：{deleted} 个',
                'entity.facetValues': '筛选属性值',
                'nav.productVariants': '商品 SKU',
                'nav.sellers': '商家',
            },
        },
    });

    it('localizes dynamic entity names before they are interpolated into notifications', () => {
        expect(getBulkActionEntityLabel(i18n, 'product variants')).toBe('商品 SKU');
        expect(getBulkActionEntityLabel(i18n, 'sellers')).toBe('商家');
        expect(getBulkActionEntityLabel(i18n, 'facet values')).toBe('筛选属性值');
    });

    it('produces a fully localized delete notification', () => {
        const entityName = getBulkActionEntityLabel(i18n, 'product variants');

        expect(i18n._('Deleted {deleted} {entityName}', { deleted: 1, entityName })).toBe(
            '商品 SKU已删除：1 个',
        );
    });
});
