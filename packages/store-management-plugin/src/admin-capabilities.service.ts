import { Injectable } from '@nestjs/common';
import {
    ADMIN_CAPABILITY_DEFINITIONS,
    adminCapabilityScopeAllows,
    AdminCapabilitySnapshot,
    AdminCapabilityState,
    AdminCapabilityStatus,
    AdminCommerceMode,
} from '@vendure/common/lib/admin-capabilities';
import { Permission } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    Channel,
    ForbiddenError,
    RequestContext,
    ShippingMethodService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationConfigService } from '@vendure/operations-dashboard-plugin';

import { AdministratorAccessService } from './administrator-access.service';
import { hasReadyShippingMethod } from './store-activation-readiness.service';
import { StoreCommerceSettingsService } from './store-commerce-settings.service';
import { StoreUsdtWalletService } from './usdt/store-usdt-wallet.service';

export interface AdminImageCapabilityReadiness {
    enabled: boolean;
    configured: boolean;
}
type ConfigurationState = Extract<AdminCapabilityState, 'READY' | 'NEEDS_CONFIGURATION' | 'DISABLED'>;

/** A non-sensitive, fresh view of the current Channel; never an authorization grant. */
@Injectable()
export class AdminCapabilitiesService {
    private imageReadiness?: (ctx: RequestContext) => Promise<AdminImageCapabilityReadiness>;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly access: AdministratorAccessService,
        private readonly commerce: StoreCommerceSettingsService,
        private readonly wallets: StoreUsdtWalletService,
        private readonly notifications: AdminNotificationConfigService,
        private readonly shippingMethods: ShippingMethodService,
    ) {}

    // The AI plugin already imports StoreManagementPlugin. Registration avoids a circular import.
    registerImageReadiness(reader: (ctx: RequestContext) => Promise<AdminImageCapabilityReadiness>) {
        this.imageReadiness = reader;
    }

    async current(ctx: RequestContext): Promise<AdminCapabilitySnapshot> {
        if (ctx.apiType !== 'admin' || !ctx.activeUserId) throw new ForbiddenError();
        await this.access.currentForChannel(ctx);
        const channel = await this.connection.getEntityOrThrow(ctx, Channel, ctx.channelId);
        const scope = channel.code === DEFAULT_CHANNEL_CODE ? 'PLATFORM' : 'STORE';
        const rawMode = channel.customFields?.commerceMode;
        const commerceMode: AdminCommerceMode | null =
            scope === 'STORE' &&
            (rawMode === 'DIGITAL_ONLY' || rawMode === 'PHYSICAL_ONLY' || rawMode === 'HYBRID')
                ? rawMode
                : null;
        const superAdmin = ctx.userHasPermissions([Permission.SuperAdmin]);
        const any = (permissions: readonly string[], emptyAllowed = false) =>
            permissions.length === 0
                ? emptyAllowed
                : superAdmin || permissions.some(p => ctx.userHasPermissions([p as Permission]));
        const capabilities: AdminCapabilityStatus[] = ADMIN_CAPABILITY_DEFINITIONS.map(definition => {
            if (!adminCapabilityScopeAllows(definition, scope, commerceMode)) {
                return {
                    id: definition.id,
                    state: 'UNSUPPORTED',
                    canRead: false,
                    canWrite: false,
                    canConfigure: false,
                };
            }
            const canRead =
                any(definition.readPermissions, true) &&
                (superAdmin ||
                    (definition.readAllPermissions ?? []).every(p =>
                        ctx.userHasPermissions([p as Permission]),
                    ));
            const writeScopeAllows = !definition.writeScope || definition.writeScope === scope;
            const canWrite = writeScopeAllows && any(definition.writePermissions);
            const hasConfigurationEntry =
                !definition.id.startsWith('/plugins/ai-settings/') ||
                definition.id === '/plugins/ai-settings/config';
            const canConfigure =
                hasConfigurationEntry && writeScopeAllows && any(definition.configurePermissions);
            return {
                id: definition.id,
                state: canRead || canWrite || canConfigure ? 'READY' : 'FORBIDDEN',
                canRead,
                canWrite,
                canConfigure,
            };
        });
        const states = new Map<string, Promise<ConfigurationState>>();
        for (const capability of capabilities) {
            if (capability.state !== 'READY') continue;
            const group = configurationGroup(capability.id);
            if (!group) continue;
            if (group === 'image' && !this.imageReadiness) {
                capability.state = 'UNSUPPORTED';
                capability.canRead = capability.canWrite = capability.canConfigure = false;
                continue;
            }
            if (!states.has(group)) states.set(group, this.configurationState(ctx, group, scope));
        }
        try {
            const resolvedStates = new Map(
                await Promise.all([...states].map(async ([group, state]) => [group, await state] as const)),
            );
            for (const capability of capabilities) {
                if (capability.state !== 'READY') continue;
                const state = resolvedStates.get(configurationGroup(capability.id) ?? '');
                if (!state) continue;
                capability.state = state;
                if (capability.state !== 'READY') capability.canWrite = false;
            }
        } catch {
            // No partial permissive snapshot and no provider error details/secrets leave this endpoint.
            throw new UserInputError('功能配置读取失败，请重试');
        }
        return {
            channelId: String(channel.id),
            channelCode: channel.code,
            scope,
            commerceMode,
            capabilities,
        };
    }

    private async configurationState(
        ctx: RequestContext,
        group: string,
        scope: 'PLATFORM' | 'STORE',
    ): Promise<ConfigurationState> {
        if (group === 'image') {
            const reader = this.imageReadiness;
            if (!reader) throw new UserInputError('功能配置读取失败，请重试');
            const status = await reader(ctx);
            return configurationState(status.configured, status.enabled);
        }
        if (group === 'telegram') {
            const status = await this.notifications.get();
            return configurationState(status.tokenConfigured && Boolean(status.chatId), status.enabled);
        }
        if (group === 'usdt') return configurationState((await this.wallets.status(ctx)).configured);
        if (group === 'payment') {
            const options = await this.commerce.paymentOptions(ctx);
            return configurationState(
                options.some(option =>
                    scope === 'PLATFORM' ? option.platformEnabled : option.effectiveEnabled,
                ),
            );
        }
        if (group === 'shipping') {
            if (scope === 'PLATFORM') {
                const management = await this.shippingMethods.getShippingTemplateManagement(ctx);
                return configurationState(management.items.some(item => item.platformTemplate));
            }
            const [channel, methods] = await Promise.all([
                this.connection.getEntityOrThrow(ctx, Channel, ctx.channelId, {
                    relations: ['defaultShippingZone', 'defaultShippingZone.members'],
                }),
                this.shippingMethods.getActiveShippingMethods(ctx),
            ]);
            return configurationState(hasReadyShippingMethod(channel, methods));
        }
        return 'READY';
    }
}

function configurationState(configured: boolean, enabled = true): ConfigurationState {
    return !configured ? 'NEEDS_CONFIGURATION' : enabled ? 'READY' : 'DISABLED';
}

function configurationGroup(id: string): string | null {
    if (
        ['/plugins/ai-settings/config', '/plugins/ai-settings/jobs', '/plugins/ai-settings/usage'].includes(
            id,
        )
    )
        return 'image';
    if (id === '/settings/system-ops/telegram') return 'telegram';
    if (id === '/settings/store-profile/payment') return 'payment';
    if (id === '/settings/store-profile/shipping') return 'shipping';
    if (
        id.startsWith('/settings/usdt-payments/') ||
        id === '/settings/store-profile/usdt' ||
        id.startsWith('/settings/store-profile/usdt-')
    )
        return 'usdt';
    return null;
}
