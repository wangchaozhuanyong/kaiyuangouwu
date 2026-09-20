import { Inject, Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { Customer, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { StorefrontContentBlock } from '@vendure/storefront-content-plugin';
import { createHash, createHmac } from 'node:crypto';
import { MoreThanOrEqual } from 'typeorm';

import { STOREFRONT_PROMOTION_OPTIONS } from './constants';
import { DataConsentRecord } from './entities/data-consent-record.entity';
import { StorefrontPromotionPluginOptions } from './types';

export const DATA_CONSENT_SERVICE_TOKEN = 'STORE_DATA_CONSENT_SERVICE';

export interface StorefrontRegistrationConsentInput {
    termsAccepted: boolean;
    privacyAcknowledged: boolean;
    locale: string;
}

export interface StorefrontAnalyticsConsentInput {
    consentId: string;
    granted: boolean;
    locale: string;
}

interface PolicySnapshot {
    version: string;
    digest: string;
}

const ANALYTICS_POLICY_TEXT =
    'First-party storefront analytics: daily page views and pseudonymous visitor/customer/IP hashes; optional; one-year browser preference.';
const ANALYTICS_POLICY: PolicySnapshot = {
    version: 'storefront-analytics-v1',
    digest: createHash('sha256').update(ANALYTICS_POLICY_TEXT).digest('hex'),
};

@Injectable()
export class DataConsentService {
    constructor(
        private readonly connection: TransactionalConnection,
        @Inject(STOREFRONT_PROMOTION_OPTIONS)
        private readonly options: Required<StorefrontPromotionPluginOptions>,
    ) {}

    async assertRegistrationConsent(
        ctx: RequestContext,
        input: StorefrontRegistrationConsentInput,
    ): Promise<{ terms: PolicySnapshot; privacy: PolicySnapshot; locale: string }> {
        if (!input?.termsAccepted || !input?.privacyAcknowledged) {
            throw new UserInputError('注册前必须阅读并明确同意使用条款及确认隐私政策');
        }
        const locale = normalizedLocale(input.locale);
        const [terms, privacy] = await Promise.all([
            this.legalPolicy(ctx, 'terms'),
            this.legalPolicy(ctx, 'privacy'),
        ]);
        return { terms, privacy, locale };
    }

    async existingCustomerForEmail(ctx: RequestContext, emailAddress: string): Promise<Customer | null> {
        return this.connection
            .getRepository(ctx, Customer)
            .createQueryBuilder('customer')
            .innerJoin('customer.channels', 'registrationChannel')
            .where('registrationChannel.id = :channelId', { channelId: ctx.channelId })
            .andWhere('LOWER(customer.emailAddress) = :emailAddress', {
                emailAddress: emailAddress.trim().toLowerCase(),
            })
            .getOne();
    }

    async recordRegistrationByEmail(
        ctx: RequestContext,
        emailAddress: string,
        source: 'REGISTRATION' | 'GOOGLE_REGISTRATION',
        snapshots: { terms: PolicySnapshot; privacy: PolicySnapshot; locale: string },
    ): Promise<void> {
        const customer = await this.existingCustomerForEmail(ctx, emailAddress);
        if (!customer) throw new UserInputError('注册已提交，但无法建立同意记录，请联系支持');
        const common = this.evidence(ctx, customer.id, snapshots.locale, source);
        await this.connection.getRepository(ctx, DataConsentRecord).save([
            new DataConsentRecord({
                ...common,
                purpose: 'TERMS',
                action: 'GRANTED',
                policyVersion: snapshots.terms.version,
                policyDigest: snapshots.terms.digest,
            }),
            new DataConsentRecord({
                ...common,
                purpose: 'PRIVACY',
                action: 'GRANTED',
                policyVersion: snapshots.privacy.version,
                policyDigest: snapshots.privacy.digest,
            }),
        ]);
    }

    async recordAnalyticsConsent(
        ctx: RequestContext,
        input: StorefrontAnalyticsConsentInput,
    ): Promise<DataConsentRecord> {
        if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.consentId)
        ) {
            throw new UserInputError('统计偏好标识无效');
        }
        const customer = ctx.activeUserId
            ? await this.connection
                  .getRepository(ctx, Customer)
                  .createQueryBuilder('customer')
                  .innerJoin('customer.user', 'user')
                  .where('user.id = :userId', { userId: ctx.activeUserId })
                  .getOne()
            : null;
        const common = this.evidence(
            ctx,
            customer?.id ?? null,
            normalizedLocale(input.locale),
            'COOKIE_PREFERENCE',
            input.consentId,
        );
        const repository = this.connection.getRepository(ctx, DataConsentRecord);
        const action = input.granted ? 'GRANTED' : 'WITHDRAWN';
        const latest = await repository.findOne({
            where: {
                channelId: ctx.channelId,
                subjectKeyHash: common.subjectKeyHash,
                purpose: 'ANALYTICS',
            },
            order: { createdAt: 'DESC' },
        });
        if (latest?.action === action && latest.policyVersion === ANALYTICS_POLICY.version) {
            return latest;
        }
        if (common.ipHash) {
            const recentCount = await repository.count({
                where: {
                    channelId: ctx.channelId,
                    ipHash: common.ipHash,
                    purpose: 'ANALYTICS',
                    createdAt: MoreThanOrEqual(new Date(Date.now() - 60_000)),
                },
            });
            if (recentCount >= 10) throw new UserInputError('统计偏好更新过于频繁，请稍后重试');
        }
        return repository.save(
            new DataConsentRecord({
                ...common,
                purpose: 'ANALYTICS',
                action,
                policyVersion: ANALYTICS_POLICY.version,
                policyDigest: ANALYTICS_POLICY.digest,
            }),
        );
    }

    async myRecords(ctx: RequestContext): Promise<DataConsentRecord[]> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.connection
            .getRepository(ctx, Customer)
            .createQueryBuilder('customer')
            .innerJoin('customer.user', 'user')
            .where('user.id = :userId', { userId: ctx.activeUserId })
            .getOne();
        if (!customer) throw new UserInputError('当前账号没有客户资料');
        return this.connection.getRepository(ctx, DataConsentRecord).find({
            where: { subjectKeyHash: consentSubjectHash(customer.id) },
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }

    async listRecords(ctx: RequestContext): Promise<DataConsentRecord[]> {
        return this.connection.getRepository(ctx, DataConsentRecord).find({
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }

    analyticsCookie(ctx: RequestContext, granted: boolean): string {
        const secure = ctx.req?.secure ? '; Secure' : '';
        return `storefront_analytics_consent=${granted ? 'granted' : 'denied'}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    }

    private async legalPolicy(ctx: RequestContext, kind: 'terms' | 'privacy'): Promise<PolicySnapshot> {
        const blocks = await this.connection.getRepository(ctx, StorefrontContentBlock).find({
            where: { channelId: ctx.channelId, type: 'LEGAL', enabled: true },
            relations: ['items'],
            order: { position: 'ASC' },
        });
        const block = blocks.find(item => isActiveLegalBlock(item) && legalBlockMatches(item, kind));
        if (!block) throw new UserInputError(`${kind === 'terms' ? '使用条款' : '隐私政策'}尚未配置`);
        const matchedItems = (block.items ?? []).filter(
            item => item.enabled !== false && legalItemMatches(item.targetValue, kind),
        );
        const canonical = JSON.stringify({
            kind,
            id: String(block.id),
            code: block.code,
            updatedAt: block.updatedAt.toISOString(),
            translations: (block.translations ?? [])
                .map(item => ({
                    languageCode: item.languageCode,
                    title: item.title,
                    subtitle: item.subtitle,
                    body: item.body,
                    ctaLabel: item.ctaLabel,
                }))
                .sort((left, right) => left.languageCode.localeCompare(right.languageCode)),
            items: matchedItems
                .map(item => ({
                    id: String(item.id),
                    updatedAt: item.updatedAt.toISOString(),
                    translations: (item.translations ?? [])
                        .map(translation => ({
                            languageCode: translation.languageCode,
                            label: translation.label,
                            description: translation.description,
                        }))
                        .sort((left, right) => left.languageCode.localeCompare(right.languageCode)),
                }))
                .sort((left, right) => left.id.localeCompare(right.id)),
        });
        const digest = createHash('sha256').update(canonical).digest('hex');
        return {
            version: `${kind}-${block.updatedAt.toISOString()}-${digest.slice(0, 12)}`,
            digest,
        };
    }

    private evidence(
        ctx: RequestContext,
        customerId: ID | null,
        locale: string,
        source: string,
        anonymousConsentId?: string,
    ) {
        const subjectKeyHash = customerId
            ? consentSubjectHash(customerId)
            : createHmac('sha256', this.options.signingSecret)
                  .update(`anonymous-consent:${anonymousConsentId ?? ''}`)
                  .digest('hex');
        const ip = ctx.req?.ip?.trim();
        const userAgent = ctx.req?.headers['user-agent']?.trim();
        return {
            channelId: ctx.channelId,
            customerId,
            subjectKeyHash,
            locale,
            source,
            ipHash: ip ? this.evidenceHash('ip', ip) : null,
            userAgentHash: userAgent ? this.evidenceHash('user-agent', userAgent) : null,
            recordedAt: new Date(),
        };
    }

    private evidenceHash(purpose: string, value: string): string {
        return createHmac('sha256', this.options.signingSecret)
            .update(`data-consent:${purpose}:${value}`)
            .digest('hex');
    }
}

export function consentSubjectHash(customerId: ID): string {
    return createHash('sha256')
        .update(`data-consent-subject:${String(customerId)}`)
        .digest('hex');
}

function normalizedLocale(value: string): string {
    const locale = value?.trim().toLowerCase();
    return /^(zh|en)(-[a-z]{2})?$/u.test(locale) ? locale : 'en';
}

function legalBlockMatches(block: StorefrontContentBlock, kind: 'terms' | 'privacy'): boolean {
    const code = block.code.trim().toLowerCase();
    return (
        (kind === 'terms' ? ['terms', 'terms-of-use'] : ['privacy', 'privacy-policy']).includes(code) ||
        (block.items ?? []).some(item => item.enabled !== false && legalItemMatches(item.targetValue, kind))
    );
}

function isActiveLegalBlock(block: StorefrontContentBlock): boolean {
    const now = Date.now();
    return (!block.startsAt || +block.startsAt <= now) && (!block.endsAt || +block.endsAt > now);
}

function legalItemMatches(targetValue: string | null | undefined, kind: 'terms' | 'privacy'): boolean {
    const normalized = (targetValue ?? '').trim().toLowerCase().replace(/^#?\//u, '');
    return normalized === kind || normalized === `legal?id=${kind}`;
}
