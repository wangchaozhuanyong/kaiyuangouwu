import { Injectable } from '@nestjs/common';
import {
    AssignShippingMethodsToChannelInput,
    ConfigurableOperationDefinition,
    CreateShippingMethodInput,
    CurrencyCode,
    DeletionResponse,
    DeletionResult,
    Permission,
    RemoveShippingMethodsFromChannelInput,
    UpdateShippingMethodInput,
} from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { randomUUID } from 'node:crypto';
import { IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { EntityNotFoundError, ForbiddenError, UserInputError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { SettingsStoreScopes } from '../../config/settings-store/settings-store-types';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { SettingsStoreEntry } from '../../entity/settings-store-entry/settings-store-entry.entity';
import { ShippingMethodTranslation } from '../../entity/shipping-method/shipping-method-translation.entity';
import { ShippingMethod } from '../../entity/shipping-method/shipping-method.entity';
import { EventBus } from '../../event-bus';
import { ShippingMethodEvent } from '../../event-bus/events/shipping-method-event';
import { ConfigArgService } from '../helpers/config-arg/config-arg.service';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { SettingsStoreService } from '../helpers/settings-store/settings-store.service';
import {
    PLATFORM_SHIPPING_TEMPLATES_KEY,
    PLATFORM_SHIPPING_TEMPLATE_INPUTS,
    PlatformShippingTemplateSettings,
    STORE_SHIPPING_METHODS_KEY,
    StoreShippingMethodSettings,
    platformShippingTemplateIds,
    platformShippingTemplateVersions,
    storeShippingMethodSettings,
} from '../helpers/shipping-calculator/shipping-template-settings';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';

import { ChannelService } from './channel.service';
import { RoleService } from './role.service';

/**
 * @description
 * Contains methods relating to {@link ShippingMethod} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class ShippingMethodService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private roleService: RoleService,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
        private configArgService: ConfigArgService,
        private translatableSaver: TranslatableSaver,
        private customFieldRelationService: CustomFieldRelationService,
        private eventBus: EventBus,
        private translator: TranslatorService,
        private settingsStore: SettingsStoreService,
    ) {}

    /** @internal */
    async initShippingMethods() {
        if (this.connection.platformStoreGovernanceEnabled) {
            this.settingsStore.register({
                namespace: 'shippingManagement',
                fields: [
                    { name: 'platformTemplates', readonly: true, requiresPermission: Permission.SuperAdmin },
                    {
                        name: 'storeMethods',
                        readonly: true,
                        scope: SettingsStoreScopes.channel,
                        requiresPermission: Permission.ReadShippingMethod,
                    },
                ],
            });
        }
        if (this.configService.shippingOptions.fulfillmentHandlers.length === 0) {
            throw new Error(
                'No FulfillmentHandlers were found.' +
                    ' Please ensure the VendureConfig.shippingOptions.fulfillmentHandlers array contains at least one FulfillmentHandler.',
            );
        }
        await this.verifyShippingMethods();
    }

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<ShippingMethod>,
        relations: RelationPaths<ShippingMethod> = [],
    ): Promise<PaginatedList<Translated<ShippingMethod>>> {
        return this.listQueryBuilder
            .build(ShippingMethod, options, {
                relations,
                where: { deletedAt: IsNull() },
                channelId: ctx.channelId,
                ctx,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items: items.map(i => this.translator.translate(i, ctx)),
                totalItems,
            }));
    }

    async findOne(
        ctx: RequestContext,
        shippingMethodId: ID,
        includeDeleted = false,
        relations: RelationPaths<ShippingMethod> = [],
    ): Promise<Translated<ShippingMethod> | undefined> {
        const shippingMethod = await this.connection.findOneInChannel(
            ctx,
            ShippingMethod,
            shippingMethodId,
            ctx.channelId,
            {
                relations,
                ...(includeDeleted === false ? { where: { deletedAt: IsNull() } } : {}),
            },
        );
        return (shippingMethod && this.translator.translate(shippingMethod, ctx)) ?? undefined;
    }

    async create(
        ctx: RequestContext,
        input: CreateShippingMethodInput,
        sourceCurrencyCode?: CurrencyCode,
    ): Promise<Translated<ShippingMethod>> {
        const amountCurrency = sourceCurrencyCode ?? ctx.channel.defaultCurrencyCode;
        if (this.connection.platformStoreGovernanceEnabled) {
            await this.lockShippingConfiguration(ctx);
            if (ctx.channel.code !== DEFAULT_CHANNEL_CODE)
                input = this.storeShippingInput(ctx, input, amountCurrency);
        }
        const shippingMethod = await this.translatableSaver.create({
            ctx,
            input,
            entityType: ShippingMethod,
            translationType: ShippingMethodTranslation,
            beforeSave: method => {
                method.fulfillmentHandlerCode = this.ensureValidFulfillmentHandlerCode(
                    method.code,
                    input.fulfillmentHandler,
                );
                method.checker = this.configArgService.parseInput(
                    'ShippingEligibilityChecker',
                    input.checker,
                );
                method.calculator = this.configArgService.parseInput('ShippingCalculator', input.calculator);
            },
        });
        await this.channelService.assignToCurrentChannel(shippingMethod, ctx);
        const newShippingMethod = await this.connection
            .getRepository(ctx, ShippingMethod)
            .save(shippingMethod);
        const shippingMethodWithRelations = await this.customFieldRelationService.updateRelations(
            ctx,
            ShippingMethod,
            input,
            newShippingMethod,
        );
        await this.eventBus.publish(
            new ShippingMethodEvent(ctx, shippingMethodWithRelations, 'created', input),
        );
        if (this.connection.platformStoreGovernanceEnabled && ctx.channel.code !== DEFAULT_CHANNEL_CODE) {
            const settings = await this.getStoreShippingSettings(ctx);
            settings.ownedIds.push(String(newShippingMethod.id));
            settings.sourceCurrencyCodes[String(newShippingMethod.id)] = amountCurrency;
            await this.saveShippingSettings(ctx, STORE_SHIPPING_METHODS_KEY, settings);
        }
        return assertFound(this.findOne(ctx, newShippingMethod.id));
    }

    async update(ctx: RequestContext, input: UpdateShippingMethodInput): Promise<Translated<ShippingMethod>> {
        const shippingMethod = await this.findOne(ctx, input.id, false, ['channels']);
        if (!shippingMethod) {
            throw new EntityNotFoundError('ShippingMethod', input.id);
        }
        await this.assertStoreCanMaintain(ctx, shippingMethod);
        if (this.connection.platformStoreGovernanceEnabled && ctx.channel.code !== DEFAULT_CHANNEL_CODE) {
            const settings = await this.getStoreShippingSettings(ctx);
            const sourceCurrency = settings.sourceCurrencyCodes[String(shippingMethod.id)];
            if (!sourceCurrency) throw new UserInputError('此配送模板缺少金额来源币种，请联系平台确认后编辑');
            input = this.storeShippingInput(ctx, input, sourceCurrency);
        } else if (this.connection.platformStoreGovernanceEnabled) {
            const platform = await this.settingsStore.get<PlatformShippingTemplateSettings>(
                ctx,
                PLATFORM_SHIPPING_TEMPLATES_KEY,
            );
            if (platformShippingTemplateIds(platform).includes(String(shippingMethod.id))) {
                throw new UserInputError(
                    '已发布的通用配送模板不可直接修改，请在平台创建新版本，由店铺明确选择采用',
                );
            }
        }
        const updatedShippingMethod = await this.translatableSaver.update({
            ctx,
            input: omit(input, ['checker', 'calculator']),
            entityType: ShippingMethod,
            translationType: ShippingMethodTranslation,
        });
        if (input.checker) {
            updatedShippingMethod.checker = this.configArgService.parseInput(
                'ShippingEligibilityChecker',
                input.checker,
            );
        }
        if (input.calculator) {
            updatedShippingMethod.calculator = this.configArgService.parseInput(
                'ShippingCalculator',
                input.calculator,
            );
        }
        if (input.fulfillmentHandler) {
            updatedShippingMethod.fulfillmentHandlerCode = this.ensureValidFulfillmentHandlerCode(
                updatedShippingMethod.code,
                input.fulfillmentHandler,
            );
        }
        await this.customFieldRelationService.updateRelations(
            ctx,
            ShippingMethod,
            input,
            updatedShippingMethod,
        );
        await this.connection
            .getRepository(ctx, ShippingMethod)
            .save(updatedShippingMethod, { reload: false });
        await this.eventBus.publish(new ShippingMethodEvent(ctx, updatedShippingMethod, 'updated', input));
        return assertFound(this.findOne(ctx, shippingMethod.id));
    }

    async softDelete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const shippingMethod = await this.connection.getEntityOrThrow(ctx, ShippingMethod, id, {
            channelId: ctx.channelId,
            where: { deletedAt: IsNull() },
            relations: ['channels'],
        });
        if (this.connection.platformStoreGovernanceEnabled) {
            const platform = await this.settingsStore.get<PlatformShippingTemplateSettings>(
                ctx,
                PLATFORM_SHIPPING_TEMPLATES_KEY,
            );
            if (platformShippingTemplateIds(platform).includes(String(id)))
                throw new UserInputError('已发布的通用配送模板不可删除，避免改变采用旧版店铺的规则');
        }
        await this.assertStoreCanMaintain(ctx, shippingMethod);
        shippingMethod.deletedAt = new Date();
        await this.connection.getRepository(ctx, ShippingMethod).save(shippingMethod, { reload: false });
        await this.eventBus.publish(new ShippingMethodEvent(ctx, shippingMethod, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
    }

    private async assertStoreCanMaintain(ctx: RequestContext, method: ShippingMethod): Promise<void> {
        if (
            !this.connection.platformStoreGovernanceEnabled ||
            ctx.apiType !== 'admin' ||
            ctx.channel.code === DEFAULT_CHANNEL_CODE
        ) {
            return;
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const [platform, settings] = await Promise.all([
            this.settingsStore.get<PlatformShippingTemplateSettings>(ctx, PLATFORM_SHIPPING_TEMPLATES_KEY),
            this.getStoreShippingSettings(ctx),
        ]);
        if (platformShippingTemplateIds(platform).includes(String(method.id))) {
            throw new UserInputError('平台通用配送模板只能选择启用或关闭，不能在店铺修改或删除');
        }
        if (!settings.ownedIds.includes(String(method.id))) {
            throw new UserInputError(
                '此配送方式的维护归属尚未确认，请联系平台管理员；当前店铺不能修改或删除',
            );
        }
        if (
            method.channels.some(
                channel =>
                    !idsAreEqual(channel.id, ctx.channelId) && !idsAreEqual(channel.id, defaultChannel.id),
            )
        ) {
            throw new UserInputError(
                '共享配送方式请在平台管理中心维护，店铺不能修改或删除其他店铺使用的配置',
            );
        }
    }

    async assignShippingMethodsToChannel(
        ctx: RequestContext,
        input: AssignShippingMethodsToChannelInput,
    ): Promise<Array<Translated<ShippingMethod>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.UpdateShippingMethod,
            Permission.UpdateSettings,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        for (const shippingMethodId of input.shippingMethodIds) {
            const shippingMethod = await this.connection.findOneInChannel(
                ctx,
                ShippingMethod,
                shippingMethodId,
                ctx.channelId,
            );
            await this.channelService.assignToChannels(ctx, ShippingMethod, shippingMethodId, [
                input.channelId,
            ]);
        }
        return this.connection
            .findByIdsInChannel(ctx, ShippingMethod, input.shippingMethodIds, ctx.channelId, {})
            .then(methods => methods.map(method => this.translator.translate(method, ctx)));
    }

    async removeShippingMethodsFromChannel(
        ctx: RequestContext,
        input: RemoveShippingMethodsFromChannelInput,
    ): Promise<Array<Translated<ShippingMethod>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.DeleteShippingMethod,
            Permission.DeleteSettings,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(input.channelId, defaultChannel.id)) {
            throw new UserInputError('error.items-cannot-be-removed-from-default-channel');
        }
        for (const shippingMethodId of input.shippingMethodIds) {
            const shippingMethod = await this.connection.getEntityOrThrow(
                ctx,
                ShippingMethod,
                shippingMethodId,
            );
            await this.channelService.removeFromChannels(ctx, ShippingMethod, shippingMethodId, [
                input.channelId,
            ]);
        }
        return this.connection
            .findByIdsInChannel(ctx, ShippingMethod, input.shippingMethodIds, ctx.channelId, {})
            .then(methods => methods.map(method => this.translator.translate(method, ctx)));
    }

    getShippingEligibilityCheckers(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.configArgService
            .getDefinitions('ShippingEligibilityChecker')
            .filter(
                definition =>
                    !this.connection.platformStoreGovernanceEnabled ||
                    ctx.channel.code === DEFAULT_CHANNEL_CODE ||
                    definition.code === 'store-shipping-zone-eligibility-checker',
            )
            .map(x => x.toGraphQlType(ctx));
    }

    getShippingCalculators(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.configArgService
            .getDefinitions('ShippingCalculator')
            .filter(
                definition =>
                    !this.connection.platformStoreGovernanceEnabled ||
                    ctx.channel.code === DEFAULT_CHANNEL_CODE ||
                    definition.code === 'physical-subtotal-shipping-calculator',
            )
            .map(x => x.toGraphQlType(ctx));
    }

    getFulfillmentHandlers(ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.configArgService
            .getDefinitions('FulfillmentHandler')
            .filter(
                definition =>
                    !this.connection.platformStoreGovernanceEnabled ||
                    ctx.channel.code === DEFAULT_CHANNEL_CODE ||
                    definition.code === 'manual-fulfillment',
            )
            .map(x => x.toGraphQlType(ctx));
    }

    async getActiveShippingMethods(ctx: RequestContext): Promise<ShippingMethod[]> {
        const shippingMethods = await this.connection.getRepository(ctx, ShippingMethod).find({
            relations: ['channels', 'customFields'],
            where: { deletedAt: IsNull() },
        });
        const disabledIds = this.connection.platformStoreGovernanceEnabled
            ? (await this.getStoreShippingSettings(ctx)).disabledIds
            : [];
        return shippingMethods
            .filter(sm => sm.channels.find(c => idsAreEqual(c.id, ctx.channelId)))
            .filter(sm => !disabledIds.includes(String(sm.id)))
            .map(m => this.translator.translate(m, ctx));
    }

    /** Also gate a directly submitted method ID, rather than only hiding it from eligible lists. */
    async isShippingMethodEnabled(ctx: RequestContext, id: ID): Promise<boolean> {
        return (
            !this.connection.platformStoreGovernanceEnabled ||
            !(await this.getStoreShippingSettings(ctx)).disabledIds.includes(String(id))
        );
    }

    /** Lists explicit platform templates and this store's methods, including disabled store methods. */
    async getShippingTemplateManagement(ctx: RequestContext) {
        this.assertShippingManagementContext(ctx);
        const [platform, storeSettings, local, defaultChannel] = await Promise.all([
            this.settingsStore.get<PlatformShippingTemplateSettings>(ctx, PLATFORM_SHIPPING_TEMPLATES_KEY),
            this.getStoreShippingSettings(ctx),
            this.findAll(ctx, undefined, ['channels']),
            this.channelService.getDefaultChannel(ctx),
        ]);
        const templateIds = platformShippingTemplateIds(platform);
        const versions = platformShippingTemplateVersions(platform);
        const templates = templateIds.length
            ? await this.connection.getRepository(ctx, ShippingMethod).find({
                  where: templateIds.map(id => ({ id, deletedAt: IsNull() })),
                  relations: ['channels'],
              })
            : [];
        const isPlatform = ctx.channel.code === DEFAULT_CHANNEL_CODE;
        const ownershipEntries = isPlatform ? await this.shippingOwnershipEntries(ctx) : [];
        const items = [
            ...new Map([...templates, ...local.items].map(method => [String(method.id), method])).values(),
        ];
        return {
            isPlatform,
            missingPlatformTemplates: templates.some(method => String(method.id) === platform?.freeShippingId)
                ? 0
                : 1,
            latestPlatformVersion: Math.max(0, ...versions.map(template => template.version)),
            adoptedPlatformTemplateId: storeSettings.adoptedTemplateId ?? null,
            items: items.map(method => ({
                method: this.translator.translate(method, ctx),
                platformTemplate: templateIds.includes(String(method.id)),
                templateVersion:
                    versions.find(template => template.id === String(method.id))?.version ?? null,
                latestPlatformTemplate: String(method.id) === platform?.freeShippingId,
                ownedByStore: !isPlatform && storeSettings.ownedIds.includes(String(method.id)),
                ownershipConfirmed:
                    storeSettings.ownedIds.includes(String(method.id)) ||
                    ownershipEntries.some(entry =>
                        storeShippingMethodSettings(entry.value).ownedIds.includes(String(method.id)),
                    ),
                assignedStoreChannels: method.channels
                    .filter(
                        channel =>
                            !idsAreEqual(channel.id, defaultChannel.id) &&
                            (isPlatform || idsAreEqual(channel.id, ctx.channelId)),
                    )
                    .map(channel => ({ id: channel.id, code: channel.code })),
                enabled:
                    method.channels.some(channel => idsAreEqual(channel.id, ctx.channelId)) &&
                    !storeSettings.disabledIds.includes(String(method.id)),
                sourceCurrencyCode:
                    storeSettings.sourceCurrencyCodes[String(method.id)] ??
                    this.shippingSourceCurrency(method),
            })),
        };
    }

    async initializePlatformShippingTemplates(ctx: RequestContext) {
        this.assertShippingManagementContext(ctx);
        if (ctx.channel.code !== DEFAULT_CHANNEL_CODE || !ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new UserInputError('请由超级管理员在平台管理中心创建通用配送模板');
        }
        await this.lockShippingConfiguration(ctx);
        const platform =
            (await this.settingsStore.get<PlatformShippingTemplateSettings>(
                ctx,
                PLATFORM_SHIPPING_TEMPLATES_KEY,
            )) ?? {};
        for (const template of PLATFORM_SHIPPING_TEMPLATE_INPUTS) {
            const existingId = platform[template.key];
            if (existingId && (await this.findOne(ctx, existingId))) continue;
            // A same-name or same-code legacy method is not silently adopted or overwritten.
            const method = await this.create(ctx, template.input);
            platform[template.key] = String(method.id);
            platform.versions = [
                ...platformShippingTemplateVersions(platform).filter(
                    version => version.id !== String(method.id),
                ),
                { id: String(method.id), version: 1 },
            ];
            await this.saveShippingSettings(ctx, PLATFORM_SHIPPING_TEMPLATES_KEY, platform);
        }
        return this.getShippingTemplateManagement(ctx);
    }

    async createPlatformFreeShippingVersion(ctx: RequestContext) {
        this.assertShippingManagementContext(ctx);
        if (ctx.channel.code !== DEFAULT_CHANNEL_CODE || !ctx.userHasPermissions([Permission.SuperAdmin]))
            throw new UserInputError('只能由超级管理员在平台管理中心创建通用包邮新版');
        await this.lockShippingConfiguration(ctx);
        const platform = await this.settingsStore.get<PlatformShippingTemplateSettings>(
            ctx,
            PLATFORM_SHIPPING_TEMPLATES_KEY,
        );
        if (!platform?.freeShippingId) throw new UserInputError('请先创建首版通用包邮模板');
        const versions = platformShippingTemplateVersions(platform);
        const version = Math.max(...versions.map(template => template.version)) + 1;
        const method = await this.create(ctx, {
            ...PLATFORM_SHIPPING_TEMPLATE_INPUTS[0].input,
            code: `platform-free-shipping-v${version}`,
        });
        await this.saveShippingSettings(ctx, PLATFORM_SHIPPING_TEMPLATES_KEY, {
            freeShippingId: String(method.id),
            versions: [...versions, { id: String(method.id), version }],
        });
        // Publishing never changes operating-store assignments or adopted snapshots.
        return this.getShippingTemplateManagement(ctx);
    }

    async setMyShippingTemplateEnabled(ctx: RequestContext, id: ID, enabled: boolean) {
        this.assertShippingManagementContext(ctx);
        if (
            ctx.channel.code === DEFAULT_CHANNEL_CODE ||
            ![Permission.UpdateSettings, Permission.UpdateShippingMethod].some(permission =>
                ctx.userHasPermissions([permission]),
            )
        ) {
            throw new UserInputError('请在有配送管理权限的经营店铺设置本店配送开关');
        }
        await this.lockShippingConfiguration(ctx);
        const [platform, settings] = await Promise.all([
            this.settingsStore.get<PlatformShippingTemplateSettings>(ctx, PLATFORM_SHIPPING_TEMPLATES_KEY),
            this.getStoreShippingSettings(ctx),
        ]);
        const isTemplate = platformShippingTemplateIds(platform).includes(String(id));
        if (!isTemplate && !settings.ownedIds.includes(String(id))) {
            throw new UserInputError('只能切换平台通用模板或本店创建的配送模板');
        }
        const method = isTemplate
            ? await this.connection
                  .getRepository(ctx, ShippingMethod)
                  .findOne({ where: { id, deletedAt: IsNull() }, relations: ['channels'] })
            : await this.findOne(ctx, id, false, ['channels']);
        if (!method) throw new EntityNotFoundError('ShippingMethod', id);
        if (isTemplate) {
            if (enabled) {
                for (const previousId of platformShippingTemplateIds(platform).filter(
                    templateId => templateId !== String(id),
                )) {
                    await this.channelService.removeFromChannels(ctx, ShippingMethod, previousId, [
                        ctx.channelId,
                    ]);
                    if (!settings.disabledIds.includes(previousId)) settings.disabledIds.push(previousId);
                }
                await this.channelService.assignToChannels(ctx, ShippingMethod, id, [ctx.channelId]);
                settings.adoptedTemplateId = String(id);
            } else await this.channelService.removeFromChannels(ctx, ShippingMethod, id, [ctx.channelId]);
        }
        // Persist both switches, while private templates keep channel ownership and remain manageable.
        settings.disabledIds = settings.disabledIds.filter(disabledId => disabledId !== String(id));
        if (!enabled) settings.disabledIds.push(String(id));
        await this.saveShippingSettings(ctx, STORE_SHIPPING_METHODS_KEY, settings);
        await this.eventBus.publish(new ShippingMethodEvent(ctx, method, 'updated'));
        return this.getShippingTemplateManagement(ctx);
    }

    async copyPlatformShippingTemplate(ctx: RequestContext, id: ID, name?: string) {
        this.assertShippingManagementContext(ctx);
        if (
            ctx.channel.code === DEFAULT_CHANNEL_CODE ||
            ![Permission.CreateSettings, Permission.CreateShippingMethod].some(permission =>
                ctx.userHasPermissions([permission]),
            )
        ) {
            throw new UserInputError('请在有新建配送权限的经营店铺复制模板');
        }
        const platform = await this.settingsStore.get<PlatformShippingTemplateSettings>(
            ctx,
            PLATFORM_SHIPPING_TEMPLATES_KEY,
        );
        if (!platformShippingTemplateIds(platform).includes(String(id)))
            throw new UserInputError('只能复制平台通用配送模板');
        const method = await this.connection
            .getRepository(ctx, ShippingMethod)
            .findOne({ where: { id, deletedAt: IsNull() } });
        if (!method) throw new EntityNotFoundError('ShippingMethod', id);
        const created = await this.create(ctx, {
            ...PLATFORM_SHIPPING_TEMPLATE_INPUTS[0].input,
            code: `store-shipping-${ctx.channelId}-${randomUUID()}`,
            translations: method.translations.map(translation => ({
                languageCode: translation.languageCode,
                name: name?.trim() || `${translation.name}（本店）`,
                description: translation.description,
            })),
        });
        // Copies start disabled; the merchant edits/reviews their private version before use.
        const settings = await this.getStoreShippingSettings(ctx);
        settings.disabledIds.push(String(created.id));
        await this.saveShippingSettings(ctx, STORE_SHIPPING_METHODS_KEY, settings);
        return this.getShippingTemplateManagement(ctx);
    }

    async confirmLegacyShippingMethodOwnership(
        ctx: RequestContext,
        id: ID,
        channelId: ID,
        sourceCurrencyCode: string,
    ) {
        this.assertShippingManagementContext(ctx);
        if (ctx.channel.code !== DEFAULT_CHANNEL_CODE || !ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new UserInputError('旧配送模板归属只能由超级管理员在平台管理中心确认');
        }
        const method = await this.connection
            .getRepository(ctx, ShippingMethod)
            .findOne({ where: { id, deletedAt: IsNull() }, relations: ['channels'] });
        if (!method) throw new EntityNotFoundError('ShippingMethod', id);
        const platform = await this.settingsStore.get<PlatformShippingTemplateSettings>(
            ctx,
            PLATFORM_SHIPPING_TEMPLATES_KEY,
        );
        if (platformShippingTemplateIds(platform).includes(String(id)))
            throw new UserInputError('平台通用模板不能认领为店铺私有模板');
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const stores = method.channels.filter(channel => !idsAreEqual(channel.id, defaultChannel.id));
        if (stores.length !== 1 || !idsAreEqual(stores[0].id, channelId)) {
            throw new UserInputError(
                '请显式选择唯一关联经营店铺；多店共享旧模板请由各店复制成本店模板，原件保持不变',
            );
        }
        const storeCtx = ctx.copy({ channel: stores[0] });
        await this.lockShippingConfiguration(storeCtx);
        const entries = await this.shippingOwnershipEntries(ctx);
        if (entries.some(entry => storeShippingMethodSettings(entry.value).ownedIds.includes(String(id)))) {
            throw new UserInputError('此配送模板已有明确维护归属，不能重新认领或覆盖来源币种');
        }
        const currency = this.assertLegacyShippingSource(method, sourceCurrencyCode);
        const settings = await this.getStoreShippingSettings(storeCtx);
        settings.ownedIds.push(String(id));
        settings.sourceCurrencyCodes[String(id)] = currency;
        if (method.calculator.code === 'physical-subtotal-shipping-calculator') {
            method.calculator = {
                ...method.calculator,
                args: [
                    ...method.calculator.args.filter(arg => arg.name !== 'sourceCurrencyCode'),
                    { name: 'sourceCurrencyCode', value: currency },
                ],
            };
            await this.connection.getRepository(ctx, ShippingMethod).save(method, { reload: false });
        } else if (Number(method.calculator.args.find(arg => arg.name === 'rate')?.value) !== 0) {
            throw new UserInputError(
                '此旧运费计算器不能固定金额来源，请由该店复制为本店模板，核对金额后启用',
            );
        }
        await this.saveShippingSettings(storeCtx, STORE_SHIPPING_METHODS_KEY, settings);
        await this.eventBus.publish(new ShippingMethodEvent(ctx, method, 'updated'));
        return this.getShippingTemplateManagement(ctx);
    }

    async copyLegacyShippingMethod(ctx: RequestContext, id: ID, sourceCurrencyCode: string, name?: string) {
        this.assertShippingManagementContext(ctx);
        if (
            ctx.channel.code === DEFAULT_CHANNEL_CODE ||
            ![Permission.CreateSettings, Permission.CreateShippingMethod].some(permission =>
                ctx.userHasPermissions([permission]),
            )
        ) {
            throw new UserInputError('请在有新建配送权限的经营店铺复制旧模板');
        }
        const source = await this.findOne(ctx, id);
        if (!source) throw new EntityNotFoundError('ShippingMethod', id);
        const currency = this.assertLegacyShippingSource(source, sourceCurrencyCode);
        const created = await this.create(
            ctx,
            {
                code: `store-shipping-${ctx.channelId}-${randomUUID()}`,
                checker: {
                    code: source.checker.code,
                    arguments: source.checker.args.map(arg => ({ ...arg })),
                },
                calculator: {
                    code: source.calculator.code,
                    arguments: source.calculator.args.map(arg => ({ ...arg })),
                },
                fulfillmentHandler: source.fulfillmentHandlerCode,
                translations: source.translations.map(translation => ({
                    languageCode: translation.languageCode,
                    name: name?.trim() || `${translation.name}（本店）`,
                    description: translation.description,
                    customFields: translation.customFields,
                })),
                customFields: source.customFields,
            },
            currency,
        );
        const settings = await this.getStoreShippingSettings(ctx);
        settings.disabledIds.push(String(created.id));
        await this.saveShippingSettings(ctx, STORE_SHIPPING_METHODS_KEY, settings);
        return this.getShippingTemplateManagement(ctx);
    }

    private shippingOwnershipEntries(ctx: RequestContext) {
        // Only the shipping ownership namespace is read; no unrelated settings or secrets are scanned.
        return this.connection
            .getRepository(ctx, SettingsStoreEntry)
            .find({ where: { key: STORE_SHIPPING_METHODS_KEY } });
    }

    private assertLegacyShippingSource(method: ShippingMethod, sourceCurrencyCode: string): CurrencyCode {
        if (!Object.values(CurrencyCode).includes(sourceCurrencyCode as CurrencyCode)) {
            throw new UserInputError('请明确选择有效的金额来源币种，不能留空或猜测');
        }
        const known = this.shippingSourceCurrency(method);
        if (known && known !== sourceCurrencyCode)
            throw new UserInputError(`所选来源币种与原模板记录 ${known} 不一致，不能重新解释原金额`);
        const amounts =
            method.calculator.code === 'physical-subtotal-shipping-calculator'
                ? ['baseRate', 'freeAbove']
                : method.calculator.code === 'default-shipping-calculator'
                  ? ['rate']
                  : [];
        if (
            !amounts.length ||
            amounts.some(name => {
                const value = method.calculator.args.find(arg => arg.name === name)?.value;
                return (
                    value == null ||
                    value.trim() === '' ||
                    !Number.isSafeInteger(Number(value)) ||
                    Number(value) < 0
                );
            })
        )
            throw new UserInputError('旧模板计算器或金额无法确认，请由平台核对后手动创建本店模板');
        // Reuse checker validation, including rejection of mixed digital/physical order minimums.
        this.storeShippingInput(
            { channel: {} } as RequestContext,
            {
                id: method.id,
                translations: [],
                checker: { code: method.checker.code, arguments: method.checker.args },
                calculator: { code: method.calculator.code, arguments: method.calculator.args },
            },
            sourceCurrencyCode,
        );
        return sourceCurrencyCode as CurrencyCode;
    }

    async getShippingMethodSourceCurrency(
        ctx: RequestContext,
        method: ShippingMethod,
    ): Promise<string | null> {
        return this.connection.platformStoreGovernanceEnabled
            ? ((await this.getStoreShippingSettings(ctx)).sourceCurrencyCodes[String(method.id)] ??
                  this.shippingSourceCurrency(method))
            : this.shippingSourceCurrency(method);
    }

    private shippingSourceCurrency(method: ShippingMethod): string | null {
        const value =
            method.calculator.args.find(arg => arg.name === 'sourceCurrencyCode')?.value ||
            method.calculator.args.find(arg => arg.name === 'currencyCode')?.value;
        if (!value) return null;
        try {
            const parsed = JSON.parse(value);
            return typeof parsed === 'string' ? parsed : value;
        } catch {
            return value;
        }
    }

    private storeShippingInput<T extends CreateShippingMethodInput | UpdateShippingMethodInput>(
        ctx: RequestContext,
        input: T,
        sourceCurrencyCode: string,
    ): T {
        if (
            input.fulfillmentHandler &&
            (input.fulfillmentHandler !== 'manual-fulfillment' ||
                !this.configService.shippingOptions.fulfillmentHandlers.some(
                    handler => handler.code === 'manual-fulfillment',
                ))
        )
            throw new UserInputError(
                '本店配送模板仅可使用平台已开放的人工发货方式，请联系平台确认可用配送设置',
            );
        let calculator = input.calculator;
        const checker = input.checker;
        const checkerArguments = new Map(checker?.arguments.map(arg => [arg.name, arg.value]));
        if (
            checker &&
            ![
                'store-shipping-zone-eligibility-checker',
                'supported-destination-eligibility-checker',
                'default-shipping-eligibility-checker',
            ].includes(checker.code)
        ) {
            throw new UserInputError('本店配送模板请使用本店配送区域检查器');
        }
        if (
            checker?.code === 'default-shipping-eligibility-checker' &&
            checker.arguments.some(arg => arg.name === 'orderMinimum' && Number(arg.value) > 0)
        ) {
            throw new UserInputError('免邮门槛请在实物小计运费计算器中填写，不能用数字商品小计抵扣');
        }
        if (calculator?.code === 'default-shipping-calculator') {
            const args = new Map(calculator.arguments.map(arg => [arg.name, arg.value]));
            calculator = {
                code: 'physical-subtotal-shipping-calculator',
                arguments: [
                    { name: 'baseRate', value: args.get('rate') ?? '0' },
                    { name: 'freeAbove', value: '0' },
                    { name: 'taxRate', value: args.get('taxRate') ?? '0' },
                    {
                        name: 'priceIncludesTax',
                        value: String(
                            args.get('includesTax') === 'include' ||
                                (args.get('includesTax') === 'auto' && ctx.channel.pricesIncludeTax),
                        ),
                    },
                ],
            };
        }
        if (calculator) {
            if (calculator.code !== 'physical-subtotal-shipping-calculator')
                throw new UserInputError('本店配送模板请使用实物小计运费计算器，确保币种和免邮门槛一致');
            for (const arg of calculator.arguments.filter(argument =>
                ['baseRate', 'freeAbove'].includes(argument.name),
            )) {
                if (
                    arg.value.trim() === '' ||
                    !Number.isSafeInteger(Number(arg.value)) ||
                    Number(arg.value) < 0
                ) {
                    throw new UserInputError('基础运费与免邮门槛必须为非负整数金额（系统最小货币单位）');
                }
            }
            calculator = {
                ...calculator,
                arguments: [
                    ...calculator.arguments.filter(
                        arg =>
                            ![
                                'sourceCurrencyCode',
                                'currencyCode',
                                'estimateMinDays',
                                'estimateMaxDays',
                            ].includes(arg.name),
                    ),
                    {
                        name: 'estimateMinDays',
                        value: calculator.arguments.find(arg => arg.name === 'estimateMinDays')?.value ?? '1',
                    },
                    {
                        name: 'estimateMaxDays',
                        value: calculator.arguments.find(arg => arg.name === 'estimateMaxDays')?.value ?? '3',
                    },
                    { name: 'sourceCurrencyCode', value: sourceCurrencyCode },
                ],
            };
        }
        return {
            ...input,
            ...(calculator ? { calculator } : {}),
            ...(checker
                ? {
                      checker: {
                          code: 'store-shipping-zone-eligibility-checker',
                          arguments: ['allowedCountryCodes', 'blockedPostalPrefixes'].map(name => ({
                              name,
                              value: checkerArguments.get(name) ?? '',
                          })),
                      },
                  }
                : {}),
        };
    }

    private assertShippingManagementContext(ctx: RequestContext) {
        if (ctx.apiType !== 'admin' || !this.connection.platformStoreGovernanceEnabled) {
            throw new UserInputError('配送模板管理仅在当前平台的管理后台可用');
        }
    }

    private getStoreShippingSettings(ctx: RequestContext): Promise<StoreShippingMethodSettings> {
        return this.settingsStore.get(ctx, STORE_SHIPPING_METHODS_KEY).then(storeShippingMethodSettings);
    }

    private async saveShippingSettings(
        ctx: RequestContext,
        key: string,
        value: StoreShippingMethodSettings | PlatformShippingTemplateSettings,
    ) {
        const result = await this.settingsStore.set(ctx, key, value);
        if (!result.result) throw new UserInputError('配送模板状态保存失败，请重试');
    }

    private async lockShippingConfiguration(ctx: RequestContext) {
        // Serialize scoped settings updates. SQLite serializes writes at the transaction level.
        if (['sqljs', 'sqlite', 'better-sqlite3'].includes(this.connection.rawConnection.options.type))
            return;
        await this.connection
            .getRepository(ctx, Channel)
            .findOne({ where: { id: ctx.channelId }, lock: { mode: 'pessimistic_write' } });
    }

    /**
     * Ensures that all ShippingMethods have a valid fulfillmentHandlerCode
     */
    private async verifyShippingMethods() {
        const activeShippingMethods = await this.connection.rawConnection.getRepository(ShippingMethod).find({
            where: { deletedAt: IsNull() },
        });
        for (const method of activeShippingMethods) {
            const handlerCode = method.fulfillmentHandlerCode;
            const verifiedHandlerCode = this.ensureValidFulfillmentHandlerCode(method.code, handlerCode);
            if (handlerCode !== verifiedHandlerCode) {
                method.fulfillmentHandlerCode = verifiedHandlerCode;
                await this.connection.rawConnection.getRepository(ShippingMethod).save(method);
            }
        }
    }

    private ensureValidFulfillmentHandlerCode(
        shippingMethodCode: string,
        fulfillmentHandlerCode: string,
    ): string {
        const { fulfillmentHandlers } = this.configService.shippingOptions;
        let handler = fulfillmentHandlers.find(h => h.code === fulfillmentHandlerCode);
        if (!handler) {
            handler = fulfillmentHandlers[0];
            Logger.error(
                `The ShippingMethod "${shippingMethodCode}" references an invalid FulfillmentHandler.\n` +
                    `The FulfillmentHandler with code "${fulfillmentHandlerCode}" was not found. Using "${handler.code}" instead.`,
            );
        }
        return handler.code;
    }
}
