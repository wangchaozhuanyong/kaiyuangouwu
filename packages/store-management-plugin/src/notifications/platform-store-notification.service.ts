import { Injectable } from '@nestjs/common';
import {
    Channel,
    LanguageCode,
    ProductVariant,
    ProductVariantService,
    Promotion,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import {
    AdminNotificationConfigService,
    AdminNotificationService,
} from '@vendure/operations-dashboard-plugin';
import { StoreDomain } from '@vendure/store-domain-plugin';

import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';
import { StoreProfile } from '../entities/store-profile.entity';

import { StorefrontPresenceService } from './storefront-presence.service';

export const EXPIRY_REMINDER_MS = 72 * 60 * 60_000;
export function duePromotion(end: Date | null, enabled: boolean, archived: boolean, now = new Date()) {
    return (
        enabled &&
        !archived &&
        end != null &&
        end > now &&
        end.getTime() - now.getTime() <= EXPIRY_REMINDER_MS
    );
}
export function hourReportKey(now: Date) {
    return Math.floor(now.getTime() / 3_600_000).toString();
}
export function storeDisplayName(channel: Channel) {
    const name = (channel.customFields as { storefrontNameZh?: string })?.storefrontNameZh?.trim();
    return name || (/\p{Script=Han}/u.test(channel.code) ? channel.code : `店铺 ${channel.id}`);
}

@Injectable()
export class PlatformStoreNotificationService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly contexts: RequestContextService,
        private readonly presence: StorefrontPresenceService,
        private readonly config: AdminNotificationConfigService,
        private readonly notifications: AdminNotificationService,
        private readonly variants: ProductVariantService,
    ) {}

    async stores(): Promise<Channel[]> {
        const domains = await this.connection.rawConnection
            .getRepository(StoreDomain)
            .find({ where: { status: 'ACTIVE', isPrimary: true }, select: ['channelId'] });
        const domainChannels = new Set(domains.map(domain => String(domain.channelId)));
        const profiles = await this.connection.rawConnection
            .getRepository(StoreProfile)
            .find({ select: ['channelId', 'status'] });
        const profileMap = new Map(profiles.map(profile => [String(profile.channelId), profile.status]));
        const channels = await this.connection.rawConnection
            .getRepository(Channel)
            .find({ order: { id: 'ASC' } });
        return channels.filter(channel => {
            const status = profileMap.get(String(channel.id));
            if (status && status !== 'ACTIVE') return false;
            if (channel.code === '__default_channel__') return domainChannels.has(String(channel.id));
            return status === 'ACTIVE' || domainChannels.has(String(channel.id));
        });
    }

    async reconcile(now = new Date()) {
        const config = await this.config.get();
        if (!config.enabled) return { stores: 0 };
        const channels = await this.stores();
        if (now.getUTCMinutes() === 0) await this.presence.purge();
        if (config.notifyOnlineReports && now.getUTCMinutes() < 5) await this.hourly(channels, now);
        for (const channel of channels) {
            const ctx = await this.contexts.create({
                apiType: 'admin',
                channelOrToken: channel,
                languageCode: LanguageCode.zh_Hans,
            });
            if (config.notifyPromotionExpiry) await this.promotions(ctx, now);
            // A periodic read also catches direct catalog/import edits which do not emit stock movements.
            if (config.notifyInventoryEvents && now.getUTCMinutes() % 10 === 0)
                await this.inventory(ctx, config.inventoryLowThreshold);
        }
        return { stores: channels.length };
    }

    private async hourly(channels: Channel[], now: Date) {
        const shops = [];
        for (const channel of channels) {
            try {
                const ctx = await this.contexts.create({
                    apiType: 'admin',
                    channelOrToken: channel,
                    languageCode: LanguageCode.zh_Hans,
                });
                shops.push({ name: storeDisplayName(channel), ...(await this.presence.snapshot(ctx, now)) });
            } catch {
                shops.push({
                    name: storeDisplayName(channel),
                    total: null,
                    guests: null,
                    customers: null,
                    available: false,
                });
            }
        }
        const allAvailable = shops.length > 0 && shops.every(shop => shop.available);
        const runtime = await this.notifications.status().catch(() => null);
        const activeIncidents = await this.notifications.activeIncidentCount().catch(() => null);
        const monitoredState =
            !runtime || activeIncidents == null || !allAvailable
                ? '部分监测不可用'
                : activeIncidents > 0 || runtime.dead > 0
                  ? `存在待处理告警 ${activeIncidents} 项`
                  : !runtime.running
                    ? '通知工作进程暂不可用'
                    : '已接入监测暂未发现告警';
        const securityConfig = await this.config.get();
        const unmonitored = `${!securityConfig.notifySecurityEvents ? '安全告警未启用；' : ''}${!process.env.ADMIN_TWO_FACTOR_ENCRYPTION_KEY ? '后台账号异常尝试未监测；' : ''}主机入侵与防火墙未监测`;
        for (let part = 0; part < Math.max(1, Math.ceil(shops.length / 12)); part++) {
            await this.notifications.enqueueOneOff(null, {
                eventType: 'platform.online.hourly',
                category: 'ONLINE',
                severity: 'P3',
                title: shops.length > 12 ? `平台与各店在线情况（第 ${part + 1} 部分）` : '平台与各店在线情况',
                silent: true,
                dedupKey: `platform.online.hourly:${hourReportKey(now)}:${part}`,
                occurredAt: now,
                expiresAt: new Date((Number(hourReportKey(now)) + 1 / 6) * 3_600_000),
                payload: {
                    total: allAvailable
                        ? shops.reduce((sum, shop) => sum + (shop.total ?? 0), 0)
                        : '统计暂不可用',
                    shops: shops.slice(part * 12, (part + 1) * 12),
                    countRule: '近五分钟活跃访客，平台合计为各店之和，跨店可能重复；未计拒绝统计的访客',
                    monitoredState: `${monitoredState}；${unmonitored}`,
                    adminPath: '/settings/system-ops?tab=telegram',
                },
            });
        }
    }

    async promotions(ctx: RequestContext, now = new Date()) {
        const promotions = await this.connection
            .getRepository(ctx, Promotion)
            .find({ where: { enabled: true, channels: { id: ctx.channelId } }, relations: ['translations'] });
        const configs = await this.connection
            .getRepository(ctx, StoreCouponCampaignConfig)
            .find({ where: { channelId: ctx.channelId } });
        const configMap = new Map(configs.map(config => [String(config.promotionId), config]));
        for (const promotion of promotions) {
            const coupon = configMap.get(String(promotion.id));
            const end = coupon ? coupon.claimEndsAt : promotion.endsAt;
            if (!duePromotion(end, promotion.enabled, Boolean(coupon?.archivedAt), now)) continue;
            const endsAt = end as Date;
            const name = promotion.translations?.find(
                translation => translation.languageCode === LanguageCode.zh_Hans,
            )?.name;
            const kind = coupon
                ? '优惠券领取活动'
                : promotion.actions?.some(action => action.code === 'store_flash_sale_price')
                  ? '限时促销'
                  : '优惠活动';
            await this.notifications.enqueueOneOff(ctx, {
                eventType: 'commerce.promotion.expiring',
                category: 'PROMOTION',
                severity: 'P3',
                title: '优惠活动即将结束',
                silent: true,
                dedupKey: `promotion-expiry:${ctx.channelId}:${promotion.id}:${endsAt.toISOString()}`,
                expiresAt: endsAt,
                payload: {
                    channelId: String(ctx.channelId),
                    promotionName:
                        name ??
                        (/\p{Script=Han}/u.test(promotion.name ?? '')
                            ? promotion.name
                            : `活动 ${promotion.id}`),
                    promotionKind: kind,
                    endsAt: new Intl.DateTimeFormat('zh-CN', {
                        timeZone: 'Asia/Kuala_Lumpur',
                        dateStyle: 'short',
                        timeStyle: 'short',
                        hour12: false,
                    }).format(endsAt),
                    remaining: `${Math.ceil((endsAt.getTime() - now.getTime()) / 3_600_000)} 小时`,
                    adminPath: `/marketing/promotions/${promotion.id}`,
                },
            });
        }
    }

    async inventory(ctx: RequestContext, threshold: number) {
        const repository = this.connection.getRepository(ctx, ProductVariant);
        let skip = 0;
        while (true) {
            const batch = await repository.find({
                where: { enabled: true, channels: { id: ctx.channelId }, product: { enabled: true } },
                relations: ['product', 'translations'],
                take: 100,
                skip,
                order: { id: 'ASC' },
            });
            for (const variant of batch) {
                const stock = await this.variants.getSaleableStockLevel(ctx, variant);
                const fingerprint = `inventory.variant.low:${ctx.channelId}:${variant.id}`;
                if (stock === Number.MAX_SAFE_INTEGER) {
                    await this.notifications.resolveIncident(ctx, fingerprint, {
                        reason: '商品改为无限库存，不再监测低库存',
                    });
                    continue;
                }
                if (stock <= threshold)
                    await this.notifications.upsertIncident(ctx, {
                        eventType: 'inventory.variant.low',
                        category: 'INVENTORY',
                        severity: stock <= 0 ? 'P0' : 'P1',
                        fingerprint,
                        title: stock <= 0 ? '商品已缺货' : '商品可售库存不足',
                        payload: {
                            channelId: String(ctx.channelId),
                            sku: variant.sku,
                            variantName:
                                variant.translations?.find(t => t.languageCode === LanguageCode.zh_Hans)
                                    ?.name ?? variant.name,
                            saleableStock: stock,
                            threshold,
                            adminPath: `/catalog/products/${variant.productId}`,
                        },
                    });
                else await this.notifications.resolveIncident(ctx, fingerprint, { saleableStock: stock });
            }
            if (batch.length < 100) break;
            skip += batch.length;
        }
    }
}
