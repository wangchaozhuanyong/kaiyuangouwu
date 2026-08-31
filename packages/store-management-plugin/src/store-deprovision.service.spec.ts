import { describe, expect, it } from 'vitest';

import { getStoreDeprovisionBlockers, getStoreSuspendBlockers } from './store-deprovision.service';

const pristineSuspendedStore = {
    status: 'SUSPENDED' as const,
    isDefaultChannel: false,
    isProvisioningTemplate: false,
    isActiveChannel: false,
    orderCount: 0,
    productCount: 0,
    customerCount: 0,
    extensionRecordCount: 0,
    dedicatedRoleSharedAcrossChannels: false,
    administratorWithAdditionalRoles: false,
};

describe('store deprovision safety rules', () => {
    it('allows only a pristine suspended store', () => {
        expect(getStoreDeprovisionBlockers(pristineSuspendedStore)).toEqual([]);
    });

    it('blocks deletion when auditable or financial data exists', () => {
        const blockers = getStoreDeprovisionBlockers({
            ...pristineSuspendedStore,
            orderCount: 2,
            extensionRecordCount: 3,
        });
        expect(blockers).toEqual([
            '已存在 2 笔订单，必须保留审计数据',
            '存在 3 条营销、返利、访客或支付扩展记录',
        ]);
    });

    it('blocks defaults, templates, active channels and stores not suspended', () => {
        const blockers = getStoreDeprovisionBlockers({
            ...pristineSuspendedStore,
            status: 'ACTIVE',
            isDefaultChannel: true,
            isProvisioningTemplate: true,
            isActiveChannel: true,
        });
        expect(blockers).toHaveLength(4);
        expect(blockers.join('|')).toContain('默认店铺');
        expect(blockers.join('|')).toContain('必须先暂停营业');
    });

    it('blocks role and administrator ownership ambiguity', () => {
        const blockers = getStoreDeprovisionBlockers({
            ...pristineSuspendedStore,
            dedicatedRoleSharedAcrossChannels: true,
            administratorWithAdditionalRoles: true,
        });
        expect(blockers).toHaveLength(2);
    });

    it('blocks suspension of structural channels while allowing non-empty ordinary stores', () => {
        expect(
            getStoreSuspendBlockers({
                isDefaultChannel: true,
                isProvisioningTemplate: true,
                isActiveChannel: true,
            }),
        ).toHaveLength(3);
        expect(
            getStoreSuspendBlockers({
                isDefaultChannel: false,
                isProvisioningTemplate: false,
                isActiveChannel: false,
            }),
        ).toEqual([]);
    });
});
