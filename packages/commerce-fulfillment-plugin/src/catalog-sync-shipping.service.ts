import { Injectable } from '@nestjs/common';
import {
    CatalogSyncBinding,
    CatalogSyncRule,
    Channel,
    CurrencyCode,
    Order,
    OrderLine,
    RequestContext,
    ShippingMethod,
    ShippingMethodService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { CatalogSyncSourceService } from '@vendure/store-management-plugin';
import { In } from 'typeorm';

import { quoteShippingAmounts, shippingMoneyArguments } from './catalog-sync-shipping-money';
import { getOrderLineFulfillmentType } from './fulfillment-classification';

@Injectable()
export class CatalogSyncShippingService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly sources: CatalogSyncSourceService,
        private readonly shipping: ShippingMethodService,
    ) {}

    async syncMethods(ctx: RequestContext, rule: CatalogSyncRule) {
        const source = await this.connection
            .getRepository(ctx, Channel)
            .findOneByOrFail({ id: rule.sourceChannelId });
        const target = await this.connection
            .getRepository(ctx, Channel)
            .findOneByOrFail({ id: rule.targetChannelId });
        const sourceCtx = ctx.copy({ channel: source, currencyCode: source.defaultCurrencyCode });
        const targetCtx = ctx.copy({ channel: target, currencyCode: target.defaultCurrencyCode });
        const methods = await this.shipping.getActiveShippingMethods(sourceCtx);
        const repo = this.connection.getRepository(ctx, CatalogSyncBinding);
        for (const method of methods) {
            const shared = await repo.findOne({
                where: {
                    kind: 'SHIPPING',
                    sourceId: method.id,
                    sourceChannelId: source.id,
                    targetChannelId: target.id,
                },
            });
            const own = await repo.findOne({
                where: { kind: 'SHIPPING', sourceId: method.id, ruleId: rule.id },
            });
            const input = {
                code: `catalog-sync-${source.id}-${method.id}-${target.id}`,
                fulfillmentHandler: method.fulfillmentHandlerCode,
                checker: { code: method.checker.code, arguments: method.checker.args },
                calculator: {
                    code: method.calculator.code,
                    arguments: method.calculator.args.map(arg =>
                        arg.name === 'sourceCurrencyCode'
                            ? { ...arg, value: arg.value || source.defaultCurrencyCode }
                            : arg,
                    ),
                },
                translations: method.translations
                    .filter(t =>
                        (target.availableLanguageCodes ?? [target.defaultLanguageCode]).includes(
                            t.languageCode,
                        ),
                    )
                    .map(t => ({ languageCode: t.languageCode, name: t.name, description: t.description })),
            };
            const fingerprint = method.updatedAt.toISOString();
            const saved = !shared
                ? await this.shipping.create(
                      targetCtx,
                      input,
                      ((await this.shipping.getShippingMethodSourceCurrency(sourceCtx, method)) ??
                          source.defaultCurrencyCode) as CurrencyCode,
                  )
                : shared.fingerprint !== fingerprint
                  ? await this.shipping.update(targetCtx, { id: shared.targetId, ...input })
                  : await this.connection
                        .getRepository(ctx, ShippingMethod)
                        .findOneByOrFail({ id: shared.targetId });
            await repo.save(
                new CatalogSyncBinding({
                    ...own,
                    ruleId: rule.id,
                    sourceChannelId: source.id,
                    targetChannelId: target.id,
                    sourceId: method.id,
                    targetId: saved.id,
                    kind: 'SHIPPING',
                    state: 'ACTIVE',
                    fingerprint,
                    error: null,
                }),
            );
        }
        const old = await repo.find({ where: { kind: 'SHIPPING', ruleId: rule.id } });
        for (const binding of old.filter(b => !methods.some(m => String(m.id) === String(b.sourceId))))
            await repo.update(binding.id, { state: 'REMOVED' });
    }

    async scope(ctx: RequestContext, order: Order, method?: ShippingMethod) {
        const repo = this.connection.getRepository(ctx, CatalogSyncBinding);
        const managed = await this.sources.hasManagedProducts(ctx);
        if (!managed)
            return {
                ctx,
                order,
                groupId: String(ctx.channelId),
                groupName: '',
                sourceMethod: undefined as ShippingMethod | undefined,
            };
        const bindings = method
            ? await repo.find({
                  where: { kind: 'SHIPPING', targetId: method.id, targetChannelId: ctx.channelId },
              })
            : [];
        let sourceChannelId = ctx.channelId;
        if (bindings.length) {
            const active = await this.connection.getRepository(ctx, CatalogSyncRule).find({
                where: {
                    id: In(bindings.filter(b => b.state === 'ACTIVE').map(b => b.ruleId)),
                    enabled: true,
                },
            });
            if (!active.length) return null;
            sourceChannelId = bindings[0].sourceChannelId;
        }
        const groups = new Map<string, OrderLine[]>();
        for (const line of order.lines.filter(l => getOrderLineFulfillmentType(l) === 'physical')) {
            const historical = ![
                'AddingItems',
                'ArrangingPayment',
                'AwaitingManualPayment',
                'Draft',
            ].includes(order.state);
            const source = await this.sources.context(ctx, line.productVariantId, line.id, historical);
            const group = groups.get(String(source.channelId)) ?? [];
            group.push(line);
            groups.set(String(source.channelId), group);
        }
        const lines = groups.get(String(sourceChannelId));
        if (!lines?.length) return null;
        const channel = await this.connection
            .getRepository(ctx, Channel)
            .findOne({ where: { id: sourceChannelId }, relations: ['defaultShippingZone'] });
        if (!channel) return null;
        const sourceCtx = ctx.copy({ channel, currencyCode: channel.defaultCurrencyCode });
        let sourceMethod: ShippingMethod | undefined;
        if (bindings.length) {
            sourceMethod = (await this.shipping.getActiveShippingMethods(sourceCtx)).find(
                m => String(m.id) === String(bindings[0].sourceId),
            );
            if (!sourceMethod) return null;
        }
        const pricingMethod = sourceMethod ?? method;
        if (
            pricingMethod?.calculator.code === 'physical-subtotal-shipping-calculator' &&
            !quoteShippingAmounts(
                ctx,
                shippingMoneyArguments(pricingMethod.calculator.args),
                order.currencyCode ?? ctx.currencyCode,
                sourceMethod ? sourceCtx : undefined,
            )
        )
            return null;
        // Hydrated Orders include calculated getter-only properties. Preserve their
        // descriptors instead of assigning through those getters.
        const grouped = Object.create(
            Object.getPrototypeOf(order),
            Object.getOwnPropertyDescriptors(order),
        ) as Order;
        grouped.lines = lines;
        const index = [...groups.keys()].sort().indexOf(String(sourceChannelId)) + 1;
        return {
            ctx: sourceCtx,
            order: grouped,
            groupId: String(sourceChannelId),
            groupName: String(ctx.languageCode).startsWith('zh') ? `包裹 ${index}` : `Package ${index}`,
            sourceMethod,
        };
    }

    async assignment(ctx: RequestContext, method: ShippingMethod, order: Order) {
        if (await this.sources.hasManagedProducts(ctx)) {
            const expected = new Set<string>();
            const historical = ![
                'AddingItems',
                'ArrangingPayment',
                'AwaitingManualPayment',
                'Draft',
            ].includes(order.state);
            for (const line of order.lines.filter(l => getOrderLineFulfillmentType(l) === 'physical'))
                expected.add(
                    String(
                        (await this.sources.context(ctx, line.productVariantId, line.id, historical))
                            .channelId,
                    ),
                );
            const selected = await Promise.all(
                order.shippingLines.map(line =>
                    line.shippingMethod ? this.scope(ctx, order, line.shippingMethod) : Promise.resolve(null),
                ),
            );
            const ids = selected.flatMap(scope => (scope ? [scope.groupId] : []));
            if (
                ids.length !== expected.size ||
                new Set(ids).size !== expected.size ||
                [...expected].some(id => !ids.includes(id))
            )
                throw new UserInputError('请为每个包裹各选择一种可用配送方式');
        }
        return (
            (await this.scope(ctx, order, method))?.order.lines.filter(
                l => getOrderLineFulfillmentType(l) === 'physical',
            ) ?? []
        );
    }
}
