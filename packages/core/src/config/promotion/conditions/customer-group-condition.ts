import { LanguageCode } from '@vendure/common/lib/generated-types';
import ms from 'ms';
import { Subscription } from 'rxjs';

import { Cache } from '../../../cache/index';
import { idsAreEqual } from '../../../common/utils';
import { EventBus } from '../../../event-bus/event-bus';
import { CustomerGroupChangeEvent } from '../../../event-bus/events/customer-group-change-event';
import { PromotionCondition } from '../promotion-condition';

let customerService: import('../../../service/services/customer.service').CustomerService;
let cacheService: import('../../../cache/cache.service').CacheService;
let subscription: Subscription | undefined;

let groupIdCache: Cache;

export const customerGroup = new PromotionCondition({
    code: 'customer_group',
    description: [
        { languageCode: LanguageCode.en, value: 'Customer belongs to the specified customer group' },
        { languageCode: LanguageCode.zh_Hans, value: '客户属于指定客户组' },
    ],
    args: {
        customerGroupId: {
            type: 'ID',
            ui: { component: 'customer-group-form-input' },
            label: [
                { languageCode: LanguageCode.en, value: 'Customer group' },
                { languageCode: LanguageCode.zh_Hans, value: '客户组' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Only customers in this group qualify.' },
                { languageCode: LanguageCode.zh_Hans, value: '只有属于该客户组的客户才能参加活动。' },
            ],
        },
    },
    async init(injector) {
        // Lazily-imported to avoid circular dependency issues.
        const { CustomerService } = await import('../../../service/services/customer.service.js');
        const { CacheService } = await import('../../../cache/cache.service.js');
        customerService = injector.get(CustomerService);
        cacheService = injector.get(CacheService);
        groupIdCache = cacheService.createCache({
            getKey: id => `PromotionCondition:customer_group:${id}`,
            options: { ttl: ms('1 week') },
        });
        subscription = injector
            .get(EventBus)
            .ofType(CustomerGroupChangeEvent)
            .subscribe(async event => {
                // When a customer is added to or removed from a group, we need
                // to invalidate the cache for that customer id
                await groupIdCache.delete(event.customers.map(c => c.id));
            });
    },
    destroy() {
        subscription?.unsubscribe();
    },
    async check(ctx, order, args) {
        if (!order.customer) {
            return false;
        }
        const customerId = order.customer.id;
        const groupIds = await groupIdCache.get(customerId, async () => {
            const groups = await customerService.getCustomerGroups(ctx, customerId);
            return groups.map(g => g.id);
        });

        return !!groupIds.find(id => idsAreEqual(id, args.customerGroupId));
    },
});
