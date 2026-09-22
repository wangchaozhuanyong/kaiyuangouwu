import { OrderProcess } from '@vendure/core';

import { FraudRiskService } from './fraud-risk.service';

let fraudRiskService: FraudRiskService;

export const fraudRiskOrderProcess: OrderProcess<string> = {
    init(injector) {
        fraudRiskService = injector.get(FraudRiskService);
    },

    async onTransitionStart(_fromState, toState, { ctx, order }) {
        if (toState !== 'ArrangingPayment') return;
        const risk = await fraudRiskService.evaluateOrder(ctx, order.id);
        if (risk.blocked) {
            return `订单需人工风险复核（${risk.caseCode ?? '待分配'}），复核通过后可继续支付`;
        }
    },
};
