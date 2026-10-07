import { Injectable } from '@nestjs/common';
import { PaymentMethodQuote } from '@vendure/common/lib/generated-shop-types';
import {
    AssignPaymentMethodsToChannelInput,
    ConfigurableOperationDefinition,
    CreatePaymentMethodInput,
    DeletionResponse,
    DeletionResult,
    Permission,
    RemovePaymentMethodsFromChannelInput,
    UpdatePaymentMethodInput,
} from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { createHash } from 'node:crypto';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { ForbiddenError, UserInputError } from '../../common/error/errors';
import { safeOperationErrorMessage } from '../../common/error/safe-operation-error';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { PaymentMethodEligibilityChecker } from '../../config/payment/payment-method-eligibility-checker';
import { PaymentMethodHandler } from '../../config/payment/payment-method-handler';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Order } from '../../entity/order/order.entity';
import { PaymentMethodTranslation } from '../../entity/payment-method/payment-method-translation.entity';
import { PaymentMethod } from '../../entity/payment-method/payment-method.entity';
import { StorePaymentMethodState } from '../../entity/payment-method/store-payment-method-state.entity';
import { EventBus } from '../../event-bus/event-bus';
import { PaymentMethodEvent } from '../../event-bus/events/payment-method-event';
import { ConfigArgService } from '../helpers/config-arg/config-arg.service';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';

import { ChannelService } from './channel.service';
import { RoleService } from './role.service';

/** Server-only settlement scope, constructed after validating an already accepted payment intent. */
export interface AcceptedPaymentIntent {
    channelId: ID;
    orderId: ID;
    method: string;
    paymentMethodId: ID;
    handlerCode: string;
    handlerArgumentsHash: string;
    amount: number;
    currencyCode: string;
}

export function paymentHandlerArgumentsHash(args: ReadonlyArray<{ name: string; value: string }>): string {
    return createHash('sha256')
        .update(
            JSON.stringify(
                args.map(({ name, value }) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name)),
            ),
        )
        .digest('hex');
}

/**
 * @description
 * Contains methods relating to {@link PaymentMethod} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class PaymentMethodService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private roleService: RoleService,
        private listQueryBuilder: ListQueryBuilder,
        private eventBus: EventBus,
        private configArgService: ConfigArgService,
        private channelService: ChannelService,
        private customFieldRelationService: CustomFieldRelationService,
        private translatableSaver: TranslatableSaver,
        private translator: TranslatorService,
    ) {}

    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<PaymentMethod>,
        relations: RelationPaths<PaymentMethod> = [],
    ): Promise<PaginatedList<PaymentMethod>> {
        if (!this.connection.platformStoreGovernanceEnabled) {
            const [items, totalItems] = await this.listQueryBuilder
                .build(PaymentMethod, options, { ctx, relations, channelId: ctx.channelId })
                .getManyAndCount();
            return { items: items.map(method => this.translator.translate(method, ctx)), totalItems };
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const states = await this.connection
            .getRepository(ctx, StorePaymentMethodState)
            .find({ where: { channelId: ctx.channelId } });
        return this.listQueryBuilder
            .build(PaymentMethod, options, { ctx, relations, channelId: defaultChannel.id })
            .getManyAndCount()
            .then(([methods, totalItems]) => {
                const items = methods.map(m =>
                    this.safeAdminMethod(ctx, this.translator.translate(m, ctx), states),
                );
                return {
                    items,
                    totalItems,
                };
            });
    }

    async findOne(
        ctx: RequestContext,
        paymentMethodId: ID,
        relations: RelationPaths<PaymentMethod> = [],
    ): Promise<PaymentMethod | undefined> {
        if (!this.connection.platformStoreGovernanceEnabled) {
            const nativeMethod = await this.connection.findOneInChannel(
                ctx,
                PaymentMethod,
                paymentMethodId,
                ctx.channelId,
                { relations },
            );
            return nativeMethod ? this.translator.translate(nativeMethod, ctx) : undefined;
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const method = await this.connection.findOneInChannel(
            ctx,
            PaymentMethod,
            paymentMethodId,
            defaultChannel.id,
            { relations },
        );
        if (!method) return;
        const states = await this.connection
            .getRepository(ctx, StorePaymentMethodState)
            .find({ where: { channelId: ctx.channelId } });
        return this.safeAdminMethod(ctx, this.translator.translate(method, ctx), states);
    }

    private safeAdminMethod(
        ctx: RequestContext,
        method: PaymentMethod,
        states: StorePaymentMethodState[],
    ): PaymentMethod {
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) return method;
        return Object.assign(new PaymentMethod(method), {
            enabled:
                method.enabled && states.some(s => idsAreEqual(s.paymentMethodId, method.id) && s.enabled),
            handler: { code: method.handler.code, args: [] },
            checker: method.checker ? { code: method.checker.code, args: [] } : null,
            customFields: {},
            // Do not return configurable credentials nested inside custom translation fields.
            translations: method.translations.map(t => ({ ...t, customFields: {} })),
        });
    }

    private assertPlatformConfiguration(ctx: RequestContext): void {
        if (!this.connection.platformStoreGovernanceEnabled) return;
        if (
            ctx.apiType !== 'admin' ||
            ctx.channel.code !== DEFAULT_CHANNEL_CODE ||
            (ctx.activeUserId != null && !ctx.userHasPermissions([Permission.SuperAdmin]))
        ) {
            throw new UserInputError('支付系统配置仅允许超级管理员在平台管理中心修改');
        }
    }

    async getStorePaymentOptions(ctx: RequestContext) {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const [methods, states] = await Promise.all([
            this.connection
                .getRepository(ctx, PaymentMethod)
                .find({ where: { channels: { id: defaultChannel.id } }, relations: ['channels'] }),
            this.connection
                .getRepository(ctx, StorePaymentMethodState)
                .find({ where: { channelId: ctx.channelId } }),
        ]);
        return methods.map(method => {
            const translated = this.translator.translate(method, ctx);
            const enabled =
                ctx.channel.code !== DEFAULT_CHANNEL_CODE &&
                states.some(s => idsAreEqual(s.paymentMethodId, method.id) && s.enabled);
            return {
                id: method.id,
                name: translated.name,
                description: translated.description,
                code: method.code,
                handlerCode: method.handler.code,
                enabled,
                platformEnabled: method.enabled,
                effectiveEnabled: enabled && method.enabled,
            };
        });
    }

    async setStorePaymentOptionEnabled(ctx: RequestContext, id: ID, enabled: boolean) {
        if (ctx.apiType !== 'admin' || ctx.channel.code === DEFAULT_CHANNEL_CODE)
            throw new UserInputError('请在经营店铺设置本店支付开关');
        if (
            ![
                Permission.SuperAdmin,
                Permission.UpdatePaymentMethod,
                Permission.UpdateSettings,
                'UpdateStoreProfile' as Permission,
            ].some(permission => ctx.userHasPermissions([permission]))
        )
            throw new ForbiddenError();
        const options = await this.getStorePaymentOptions(ctx);
        const method = options.find(m => idsAreEqual(m.id, id));
        if (!method) throw new UserInputError('该支付方式未由平台配置');
        if (enabled && !method.platformEnabled) throw new UserInputError('平台尚未启用该支付方式');
        await this.connection
            .getRepository(ctx, StorePaymentMethodState)
            .upsert({ channelId: ctx.channelId, paymentMethodId: id, enabled }, [
                'channelId',
                'paymentMethodId',
            ]);
        return { ...method, enabled, effectiveEnabled: enabled && method.platformEnabled };
    }

    async create(ctx: RequestContext, input: CreatePaymentMethodInput): Promise<PaymentMethod> {
        this.assertPlatformConfiguration(ctx);
        const savedPaymentMethod = await this.translatableSaver.create({
            ctx,
            input,
            entityType: PaymentMethod,
            translationType: PaymentMethodTranslation,
            beforeSave: async pm => {
                pm.handler = this.configArgService.parseInput('PaymentMethodHandler', input.handler);
                if (input.checker) {
                    pm.checker = this.configArgService.parseInput(
                        'PaymentMethodEligibilityChecker',
                        input.checker,
                    );
                }
                await this.channelService.assignToCurrentChannel(pm, ctx);
            },
        });
        await this.customFieldRelationService.updateRelations(ctx, PaymentMethod, input, savedPaymentMethod);
        await this.eventBus.publish(new PaymentMethodEvent(ctx, savedPaymentMethod, 'created', input));
        return assertFound(this.findOne(ctx, savedPaymentMethod.id));
    }

    async update(ctx: RequestContext, input: UpdatePaymentMethodInput): Promise<PaymentMethod> {
        this.assertPlatformConfiguration(ctx);
        // Ensure the entity belongs to the active channel before updating.
        await this.connection.getEntityOrThrow(ctx, PaymentMethod, input.id, { channelId: ctx.channelId });
        const updatedPaymentMethod = await this.translatableSaver.update({
            ctx,
            input,
            entityType: PaymentMethod,
            translationType: PaymentMethodTranslation,
            beforeSave: pm => {
                if (input.checker) {
                    pm.checker = this.configArgService.parseInput(
                        'PaymentMethodEligibilityChecker',
                        input.checker,
                    );
                }
                if (input.checker === null) {
                    pm.checker = null;
                }
                if (input.handler) {
                    pm.handler = this.configArgService.parseInput('PaymentMethodHandler', input.handler);
                }
            },
        });
        await this.customFieldRelationService.updateRelations(
            ctx,
            PaymentMethod,
            input,
            updatedPaymentMethod,
        );
        await this.connection.getRepository(ctx, PaymentMethod).save(updatedPaymentMethod, { reload: false });
        await this.eventBus.publish(new PaymentMethodEvent(ctx, updatedPaymentMethod, 'updated', input));
        return assertFound(this.findOne(ctx, updatedPaymentMethod.id));
    }

    async delete(
        ctx: RequestContext,
        paymentMethodId: ID,
        force: boolean = false,
    ): Promise<DeletionResponse> {
        this.assertPlatformConfiguration(ctx);
        const paymentMethod = await this.connection.getEntityOrThrow(ctx, PaymentMethod, paymentMethodId, {
            relations: ['channels'],
            channelId: ctx.channelId,
        });
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) {
            const nonDefaultChannels = paymentMethod.channels.filter(
                channel => channel.code !== DEFAULT_CHANNEL_CODE,
            );
            if (0 < nonDefaultChannels.length && !force) {
                const message = ctx.translate('message.payment-method-used-in-channels', {
                    channelCodes: nonDefaultChannels.map(c => c.code).join(', '),
                });
                const result = DeletionResult.NOT_DELETED;
                return { result, message };
            }
            try {
                const deletedPaymentMethod = new PaymentMethod(paymentMethod);
                await this.connection.getRepository(ctx, PaymentMethod).remove(paymentMethod);
                await this.eventBus.publish(
                    new PaymentMethodEvent(ctx, deletedPaymentMethod, 'deleted', paymentMethodId),
                );
                return {
                    result: DeletionResult.DELETED,
                };
            } catch (error: unknown) {
                return {
                    result: DeletionResult.NOT_DELETED,
                    message: safeOperationErrorMessage(
                        ctx,
                        error,
                        'message.payment-method-delete-data-conflict',
                        { name: paymentMethod.name },
                        `Could not delete PaymentMethod with id ${paymentMethodId}`,
                    ),
                };
            }
        } else {
            // If not deleting from the default channel, we will not actually delete,
            // but will remove from the current channel
            paymentMethod.channels = paymentMethod.channels.filter(c => !idsAreEqual(c.id, ctx.channelId));
            await this.connection.getRepository(ctx, PaymentMethod).save(paymentMethod);
            await this.eventBus.publish(
                new PaymentMethodEvent(ctx, paymentMethod, 'deleted', paymentMethodId),
            );
            return {
                result: DeletionResult.DELETED,
            };
        }
    }

    async assignPaymentMethodsToChannel(
        ctx: RequestContext,
        input: AssignPaymentMethodsToChannelInput,
    ): Promise<Array<Translated<PaymentMethod>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.UpdatePaymentMethod,
            Permission.UpdateSettings,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        for (const paymentMethodId of input.paymentMethodIds) {
            const paymentMethod = await this.connection.findOneInChannel(
                ctx,
                PaymentMethod,
                paymentMethodId,
                ctx.channelId,
            );
            await this.channelService.assignToChannels(ctx, PaymentMethod, paymentMethodId, [
                input.channelId,
            ]);
        }
        return this.connection
            .findByIdsInChannel(ctx, PaymentMethod, input.paymentMethodIds, ctx.channelId, {})
            .then(methods => methods.map(method => this.translator.translate(method, ctx)));
    }

    async removePaymentMethodsFromChannel(
        ctx: RequestContext,
        input: RemovePaymentMethodsFromChannelInput,
    ): Promise<Array<Translated<PaymentMethod>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.DeletePaymentMethod,
            Permission.DeleteSettings,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(input.channelId, defaultChannel.id)) {
            throw new UserInputError('error.items-cannot-be-removed-from-default-channel');
        }
        for (const paymentMethodId of input.paymentMethodIds) {
            const paymentMethod = await this.connection.getEntityOrThrow(ctx, PaymentMethod, paymentMethodId);
            await this.channelService.removeFromChannels(ctx, PaymentMethod, paymentMethodId, [
                input.channelId,
            ]);
        }
        return this.connection
            .findByIdsInChannel(ctx, PaymentMethod, input.paymentMethodIds, ctx.channelId, {})
            .then(methods => methods.map(method => this.translator.translate(method, ctx)));
    }

    getPaymentMethodEligibilityCheckers(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.configArgService
            .getDefinitions('PaymentMethodEligibilityChecker')
            .map(x => x.toGraphQlType(ctx));
    }

    getPaymentMethodHandlers(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.configArgService.getDefinitions('PaymentMethodHandler').map(x => x.toGraphQlType(ctx));
    }

    async getEligiblePaymentMethods(ctx: RequestContext, order: Order): Promise<PaymentMethodQuote[]> {
        const paymentMethodsInChannel = await this.getActivePaymentMethods(ctx);
        const results: PaymentMethodQuote[] = [];
        for (const method of paymentMethodsInChannel) {
            let isEligible = true;
            let eligibilityMessage: string | undefined;
            if (method.checker) {
                const checker = this.configArgService.getByCode(
                    'PaymentMethodEligibilityChecker',
                    method.checker.code,
                );
                const eligible = await checker.check(ctx, order, method.checker.args, method);
                if (eligible === false || typeof eligible === 'string') {
                    isEligible = false;
                    eligibilityMessage = typeof eligible === 'string' ? eligible : undefined;
                }
            }

            results.push({
                id: method.id,
                code: method.code,
                name: method.name,
                description: method.description,
                isEligible,
                eligibilityMessage,
                customFields: method.customFields,
            });
        }
        return results;
    }

    async getMethodAndOperations(
        ctx: RequestContext,
        method: string,
        existingPayment = false,
    ): Promise<{
        paymentMethod: PaymentMethod;
        handler: PaymentMethodHandler;
        checker: PaymentMethodEligibilityChecker | null;
    }> {
        let paymentMethod: PaymentMethod | undefined;
        if (!this.connection.platformStoreGovernanceEnabled) {
            paymentMethod =
                (await this.connection.getRepository(ctx, PaymentMethod).findOne({
                    where: { code: method, channels: { id: ctx.channelId } },
                })) ?? undefined;
        } else if (existingPayment) {
            // Existing payment records keep their original handler for settlement/refunds after a shop switch is off.
            paymentMethod =
                (await this.connection
                    .getRepository(ctx, PaymentMethod)
                    .findOne({ where: { code: method, channels: { id: ctx.channelId } } })) ?? undefined;
            if (!paymentMethod) {
                const platform = await this.channelService.getDefaultChannel(ctx);
                paymentMethod =
                    (await this.connection
                        .getRepository(ctx, PaymentMethod)
                        .findOne({ where: { code: method, channels: { id: platform.id } } })) ?? undefined;
            }
        } else {
            paymentMethod = (await this.getActivePaymentMethods(ctx)).find(m => m.code === method);
        }
        if (!paymentMethod) {
            throw new UserInputError('error.payment-method-not-found', { method });
        }
        const handler = this.configArgService.getByCode('PaymentMethodHandler', paymentMethod.handler.code);
        const checker =
            paymentMethod.checker &&
            this.configArgService.getByCode('PaymentMethodEligibilityChecker', paymentMethod.checker.code);
        return { paymentMethod, handler, checker };
    }

    /** This scope is never read from GraphQL input or payment metadata. */
    async getOperationsForAcceptedIntent(ctx: RequestContext, scope: AcceptedPaymentIntent) {
        if (!idsAreEqual(ctx.channelId, scope.channelId)) {
            throw new UserInputError('error.payment-method-not-found', { method: scope.method });
        }
        const operations = await this.getMethodAndOperations(ctx, scope.method, true);
        const method = operations.paymentMethod;
        if (
            !idsAreEqual(method.id, scope.paymentMethodId) ||
            method.code !== scope.method ||
            method.handler.code !== scope.handlerCode ||
            paymentHandlerArgumentsHash(method.handler.args) !== scope.handlerArgumentsHash
        ) {
            throw new UserInputError('error.payment-method-not-found', { method: scope.method });
        }
        return operations;
    }

    async getActivePaymentMethods(ctx: RequestContext): Promise<PaymentMethod[]> {
        if (!this.connection.platformStoreGovernanceEnabled) {
            const nativeMethods = await this.connection.getRepository(ctx, PaymentMethod).find({
                where: { enabled: true, channels: { id: ctx.channelId } },
                relations: ['channels', 'customFields'],
            });
            return nativeMethods.map(method => this.translator.translate(method, ctx));
        }
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) return [];
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const [methods, states] = await Promise.all([
            this.connection.getRepository(ctx, PaymentMethod).find({
                where: { enabled: true, channels: { id: defaultChannel.id } },
                relations: ['channels', 'customFields'],
            }),
            this.connection
                .getRepository(ctx, StorePaymentMethodState)
                .find({ where: { channelId: ctx.channelId, enabled: true } }),
        ]);
        return methods
            .filter(m => states.some(s => idsAreEqual(s.paymentMethodId, m.id)))
            .map(m => this.translator.translate(m, ctx));
    }
}
