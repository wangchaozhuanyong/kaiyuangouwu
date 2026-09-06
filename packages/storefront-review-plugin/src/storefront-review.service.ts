import { Injectable, Optional } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { ContentTranslationService, isUsableEnglishTranslation } from '@vendure/content-translation-plugin';
import {
    Customer,
    CustomerService,
    EntityNotFoundError,
    EventBus,
    OrderLine,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    translateDeep,
} from '@vendure/core';
import { FindOptionsWhere, In, Like, LockNotSupportedOnGivenDriverError } from 'typeorm';

import { StorefrontReview } from './entities/storefront-review.entity';
import { storefrontReviewStates } from './review.constants';
import { StorefrontReviewChangedEvent } from './storefront-review-changed.event';
import {
    ModerateStorefrontReviewInput,
    StorefrontReviewCandidate,
    StorefrontReviewListOptions,
    SubmitStorefrontReviewInput,
} from './types';

const TITLE_MAX_LENGTH = 120;
const BODY_MAX_LENGTH = 2_000;
const RESPONSE_MAX_LENGTH = 2_000;
const DIGITAL_REVIEW_ORDER_STATES = ['PaymentSettled', 'PartiallyShipped', 'Shipped', 'Delivered'];

export interface StorefrontReviewList {
    items: StorefrontReview[];
    totalItems: number;
    averageRating: number;
}

@Injectable()
export class StorefrontReviewService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly translations: ContentTranslationService,
        @Optional() private readonly eventBus?: EventBus,
    ) {}

    async findApprovedForProduct(
        ctx: RequestContext,
        productId: ID,
        options: StorefrontReviewListOptions = {},
    ): Promise<StorefrontReviewList> {
        const skip = this.boundedInteger(options.skip, 0, 0, 10_000);
        const take = this.boundedInteger(options.take, 10, 1, 50);
        const repository = this.connection.getRepository(ctx, StorefrontReview);
        const where = { channelId: ctx.channelId, productId, state: 'APPROVED' as const };
        const [[items, totalItems], averageRating] = await Promise.all([
            repository.findAndCount({
                where,
                order: { moderatedAt: 'DESC', createdAt: 'DESC', id: 'DESC' },
                skip,
                take,
            }),
            repository.average('rating', where),
        ]);
        return {
            items: items.map(item => this.localizeMerchantResponse(item, ctx)),
            totalItems,
            averageRating: averageRating ?? 0,
        };
    }

    async findMine(ctx: RequestContext): Promise<StorefrontReview[]> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const reviews = await this.connection.getRepository(ctx, StorefrontReview).find({
            where: { channelId: ctx.channelId, customerId: customer.id },
            order: { createdAt: 'DESC', id: 'DESC' },
        });
        return reviews.map(review => this.localizeMerchantResponse(review, ctx));
    }

    async findCandidates(ctx: RequestContext): Promise<StorefrontReviewCandidate[]> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const reviewed = await this.connection.getRepository(ctx, StorefrontReview).find({
            select: { orderLineId: true },
            where: { channelId: ctx.channelId, customerId: customer.id },
        });
        const reviewedLineIds = new Set(
            reviewed.flatMap(review => (review.orderLineId == null ? [] : [String(review.orderLineId)])),
        );
        const lines = await this.connection.getRepository(ctx, OrderLine).find({
            where: {
                order: {
                    customerId: customer.id,
                    channels: { id: ctx.channelId },
                    state: In(DIGITAL_REVIEW_ORDER_STATES),
                },
            },
            relations: {
                order: { channels: true },
                productVariant: { translations: true, product: { translations: true } },
            },
            order: { order: { orderPlacedAt: 'DESC' } },
            take: 500,
        });
        return lines
            .filter(line => !reviewedLineIds.has(String(line.id)))
            .filter(line => {
                const fulfillmentType = this.fulfillmentType(line);
                return fulfillmentType === 'digital' || line.order.state === 'Delivered';
            })
            .slice(0, 100)
            .map(line => {
                const variant = translateDeep(line.productVariant, ctx.languageCode);
                const fulfillmentType = this.fulfillmentType(line);
                return {
                    orderLineId: line.id,
                    orderId: line.order.id,
                    orderCode: line.order.code,
                    orderState: line.order.state,
                    orderPlacedAt: line.order.orderPlacedAt ?? null,
                    productId: variant.productId,
                    productVariantId: variant.id,
                    productName: variant.product?.name || variant.name,
                    variantName: variant.name,
                    sku: variant.sku,
                    fulfillmentType,
                };
            });
    }

    async findForAdmin(
        ctx: RequestContext,
        options: StorefrontReviewListOptions = {},
    ): Promise<StorefrontReviewList> {
        const skip = this.boundedInteger(options.skip, 0, 0, 10_000);
        const take = this.boundedInteger(options.take, 20, 1, 100);
        if (options.state && !storefrontReviewStates.includes(options.state)) {
            throw new UserInputError('评价状态筛选条件无效');
        }
        const repository = this.connection.getRepository(ctx, StorefrontReview);
        const baseWhere: FindOptionsWhere<StorefrontReview> = {
            channelId: ctx.channelId,
            ...(options.state ? { state: options.state } : {}),
        };
        const search = options.search?.trim().slice(0, 200);
        const where: FindOptionsWhere<StorefrontReview> | Array<FindOptionsWhere<StorefrontReview>> = search
            ? [
                  { ...baseWhere, title: Like(`%${search}%`) },
                  { ...baseWhere, body: Like(`%${search}%`) },
                  { ...baseWhere, customerName: Like(`%${search}%`) },
                  { ...baseWhere, productName: Like(`%${search}%`) },
                  { ...baseWhere, sku: Like(`%${search}%`) },
              ]
            : baseWhere;
        const [[items, totalItems], averageRating] = await Promise.all([
            repository.findAndCount({
                where,
                order: { createdAt: 'DESC', id: 'DESC' },
                skip,
                take,
            }),
            repository.average('rating', where),
        ]);
        return {
            items: items.map(item => this.localizeMerchantResponse(item, ctx)),
            totalItems,
            averageRating: averageRating ?? 0,
        };
    }

    async submit(ctx: RequestContext, input: SubmitStorefrontReviewInput): Promise<StorefrontReview> {
        const customer = await this.activeCustomerOrThrow(ctx);
        this.validateSubmission(input);
        await this.lockOrderLine(ctx, input.orderLineId);
        const line = await this.connection.getRepository(ctx, OrderLine).findOne({
            where: {
                id: input.orderLineId,
                order: {
                    customerId: customer.id,
                    channels: { id: ctx.channelId },
                },
            },
            relations: {
                order: { channels: true },
                productVariant: { translations: true, product: { translations: true } },
            },
        });
        if (!line) {
            throw new UserInputError('订单商品不存在或当前账号无权评价');
        }
        const fulfillmentType = this.fulfillmentType(line);
        const eligible =
            fulfillmentType === 'digital'
                ? DIGITAL_REVIEW_ORDER_STATES.includes(line.order.state)
                : line.order.state === 'Delivered';
        if (!eligible) {
            throw new UserInputError(
                fulfillmentType === 'digital'
                    ? '数字商品需在付款后才能评价'
                    : '实物商品需在订单完成后才能评价',
            );
        }
        const existing = await this.connection.getRepository(ctx, StorefrontReview).findOne({
            where: { orderLineId: line.id },
        });
        if (existing) {
            throw new UserInputError('该订单商品已经提交过评价');
        }
        const variant = translateDeep(line.productVariant, ctx.languageCode);
        const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
        const review = await this.connection.getRepository(ctx, StorefrontReview).save(
            new StorefrontReview({
                state: 'PENDING',
                rating: input.rating,
                title: input.title.trim(),
                body: input.body.trim(),
                customerName: this.maskCustomerName(customerName || customer.emailAddress),
                productName: variant.product?.name || variant.name,
                sku: variant.sku,
                merchantResponse: null,
                merchantResponseZh: null,
                merchantResponseEn: null,
                moderatedAt: null,
                channel: ctx.channel,
                channelId: ctx.channelId,
                customer,
                customerId: customer.id,
                order: line.order,
                orderId: line.order.id,
                orderLine: line,
                orderLineId: line.id,
                product: variant.product,
                productId: variant.productId,
                productVariant: line.productVariant,
                productVariantId: line.productVariant.id,
            }),
        );
        const saved = await this.getMineOrThrow(ctx, review.id, customer.id);
        await this.publishChanged(ctx, saved, false);
        return saved;
    }

    async moderate(ctx: RequestContext, input: ModerateStorefrontReviewInput): Promise<StorefrontReview> {
        if (!['APPROVED', 'REJECTED'].includes(input.state)) {
            throw new UserInputError('评价审核状态无效');
        }
        const response = input.response?.trim() || null;
        if (response && response.length > RESPONSE_MAX_LENGTH) {
            throw new UserInputError('商家回复不能超过 2000 个字符');
        }
        if (input.state === 'REJECTED' && (!response || response.length < 3)) {
            throw new UserInputError('驳回评价时请填写至少 3 个字符的原因');
        }
        const review = await this.connection.getRepository(ctx, StorefrontReview).findOne({
            where: { id: input.id, channelId: ctx.channelId },
        });
        if (!review) {
            throw new EntityNotFoundError(StorefrontReview.name, input.id);
        }
        if (review.state !== 'PENDING') {
            throw new UserInputError('只有待审核的评价可以处理');
        }
        const prepared = response
            ? await this.translations.prepareLocalizedFields([
                  {
                      path: 'merchantResponse',
                      sourceText: response,
                      required: true,
                  },
              ])
            : [];
        const responseEn = prepared[0]?.translatedText ?? null;
        const result = await this.connection.getRepository(ctx, StorefrontReview).update(
            { id: review.id, channelId: ctx.channelId, state: 'PENDING' },
            {
                state: input.state,
                merchantResponse: response,
                merchantResponseZh: response,
                merchantResponseEn: responseEn,
                moderatedAt: new Date(),
            },
        );
        if (result.affected !== 1) {
            throw new UserInputError('评价状态已更新，请刷新后重试');
        }
        if (prepared.length) {
            await this.translations.recordPreparedFields(
                ctx,
                {
                    channelId: ctx.channelId,
                    entityType: StorefrontReview.name,
                    entityId: review.id,
                },
                prepared,
            );
        }
        const saved = await this.getAdminOrThrow(ctx, review.id);
        await this.publishChanged(ctx, saved, input.state === 'APPROVED');
        return saved;
    }

    private async publishChanged(
        ctx: RequestContext,
        review: StorefrontReview,
        publicListingChanged: boolean,
    ): Promise<void> {
        if (review.productId == null || review.customerId == null) return;
        await this.eventBus?.publish(
            new StorefrontReviewChangedEvent(
                ctx,
                review.productId,
                review.customerId,
                review.id,
                publicListingChanged,
            ),
        );
    }

    private validateSubmission(input: SubmitStorefrontReviewInput): void {
        if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
            throw new UserInputError('评分必须是 1 到 5 之间的整数');
        }
        const title = input.title.trim();
        if (title.length < 2 || title.length > TITLE_MAX_LENGTH) {
            throw new UserInputError('评价标题需为 2 到 120 个字符');
        }
        const body = input.body.trim();
        if (body.length < 10 || body.length > BODY_MAX_LENGTH) {
            throw new UserInputError('评价内容需为 10 到 2000 个字符');
        }
    }

    private async activeCustomerOrThrow(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) {
            throw new UserInputError('请先登录');
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) {
            throw new UserInputError('当前账号没有客户资料');
        }
        return customer;
    }

    private async lockOrderLine(ctx: RequestContext, orderLineId: ID): Promise<void> {
        try {
            await this.connection
                .getRepository(ctx, OrderLine)
                .createQueryBuilder('line')
                .setLock('pessimistic_write')
                .where('line.id = :orderLineId', { orderLineId })
                .getOne();
        } catch (error) {
            if (!(error instanceof LockNotSupportedOnGivenDriverError)) {
                throw error;
            }
        }
    }

    private async getMineOrThrow(ctx: RequestContext, id: ID, customerId: ID): Promise<StorefrontReview> {
        const review = await this.connection.getRepository(ctx, StorefrontReview).findOne({
            where: { id, channelId: ctx.channelId, customerId },
        });
        if (!review) {
            throw new EntityNotFoundError(StorefrontReview.name, id);
        }
        return this.localizeMerchantResponse(review, ctx);
    }

    private async getAdminOrThrow(ctx: RequestContext, id: ID): Promise<StorefrontReview> {
        const review = await this.connection.getRepository(ctx, StorefrontReview).findOne({
            where: { id, channelId: ctx.channelId },
        });
        if (!review) {
            throw new EntityNotFoundError(StorefrontReview.name, id);
        }
        return this.localizeMerchantResponse(review, ctx);
    }

    private localizeMerchantResponse(review: StorefrontReview, ctx: RequestContext): StorefrontReview {
        const isChinese = String(ctx.languageCode).toLowerCase().startsWith('zh');
        review.merchantResponse = isChinese
            ? review.merchantResponseZh || review.merchantResponseEn || review.merchantResponse
            : isUsableEnglishTranslation(review.merchantResponseEn)
              ? review.merchantResponseEn
              : null;
        return review;
    }

    private fulfillmentType(line: OrderLine): 'physical' | 'digital' {
        const lineFields = line.customFields as { fulfillmentTypeSnapshot?: string };
        const variantFields = line.productVariant.customFields as { fulfillmentType?: string };
        return lineFields.fulfillmentTypeSnapshot === 'digital' || variantFields.fulfillmentType === 'digital'
            ? 'digital'
            : 'physical';
    }

    private maskCustomerName(value: string): string {
        const characters = Array.from(value.trim());
        if (characters.length <= 1) return `${characters[0] ?? '*'}***`;
        return `${characters[0]}***${characters.at(-1)}`;
    }

    private boundedInteger(
        value: number | null | undefined,
        fallback: number,
        min: number,
        max: number,
    ): number {
        if (value == null) return fallback;
        if (!Number.isInteger(value) || value < min || value > max) {
            throw new UserInputError(`分页参数必须是 ${min} 到 ${max} 之间的整数`);
        }
        return value;
    }
}
