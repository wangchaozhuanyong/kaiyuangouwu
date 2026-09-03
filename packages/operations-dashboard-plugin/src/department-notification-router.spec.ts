import { describe, expect, it } from 'vitest';

import {
    departmentCodes,
    DepartmentNotificationRouter,
    validateRouteOverrides,
} from './department-notification-router';

describe('DepartmentNotificationRouter', () => {
    it('defines twelve unique stable department codes', () => {
        expect(departmentCodes).toHaveLength(12);
        expect(new Set(departmentCodes).size).toBe(12);
    });

    it('routes commerce events to the responsible department', () => {
        const router = new DepartmentNotificationRouter();
        expect(router.route('commerce.order.placed', 'P3')).toMatchObject({
            owner: 'SALES',
            collaborators: ['FULFILLMENT', 'DATA_FINANCE'],
            escalation: null,
        });
        expect(router.route('commerce.payment.settled', 'P2')).toMatchObject({
            owner: 'FULFILLMENT',
            collaborators: ['DATA_FINANCE'],
        });
        expect(router.route('inventory.variant.low', 'P1')).toMatchObject({
            owner: 'SUPPLY',
            escalation: 'EXEC',
            actionRequired: true,
        });
    });

    it('does not allow a P0 override to remove EXEC escalation', () => {
        const router = new DepartmentNotificationRouter();
        const result = router.route('system.database.down', 'P0', [
            { eventType: 'system.database.down', owner: 'TECH', escalation: null },
        ]);
        expect(result.escalation).toBe('EXEC');
        expect(result.slaMinutes).toBe(0);
        expect(result.actionRequired).toBe(true);
    });

    it('falls back unknown events to EXEC instead of returning an empty owner', () => {
        expect(new DepartmentNotificationRouter().route('unknown.event', 'P2')).toMatchObject({
            owner: 'EXEC',
            fallback: true,
        });
    });

    it('rejects invalid department overrides', () => {
        expect(() =>
            validateRouteOverrides([{ eventType: 'commerce.order.placed', owner: 'UNKNOWN' }]),
        ).toThrow('主责部门无效');
    });

    it('rejects duplicate event overrides and invalid action flags', () => {
        expect(() =>
            validateRouteOverrides([
                { eventType: 'commerce.order.placed', owner: 'SALES' },
                { eventType: 'commerce.order.placed', owner: 'EXEC' },
            ]),
        ).toThrow('事件路由重复');
        expect(() =>
            validateRouteOverrides([{ eventType: 'commerce.order.placed', actionRequired: 'yes' }]),
        ).toThrow('处理要求标记无效');
    });
});
