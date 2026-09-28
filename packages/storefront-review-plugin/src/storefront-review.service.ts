import { Injectable, Optional } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { ContentTranslationService, isUsableEnglishTranslation } from '@vendure/content-translation-plugin';
import {
    AssetService,
    Customer,
    CustomerService,
    EntityNotFoundError,
    EventBus,
    OrderLine,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    processCustomerImage,
    translateDeep,
} from '@vendure/core';
import { Readable } from 'node:stream';
import { FindOptionsWhere, In, Like, Not } from 'typeorm';

import { StorefrontReview } from './entities/storefront-review.entity';
import { storefrontReviewStates } from './review.constants';
import { StorefrontReviewChangedEvent } from './storefront-review-changed.event';
import { StorefrontReviewSettingsService } from './storefront-review-settings.service';
import {
    ModerateStorefrontReviewInput,
    ReviewImageUpload,
    StorefrontReviewCandidate,
    StorefrontReviewListOptions,
    SubmitStorefrontReviewInput,
} from './types';

const TITLE_MAX_LENGTH = 120;
const BODY_MAX_LENGTH = 2_000;
const RESPONSE_MAX_LENGTH = 2_000;
const REVIEW_IMAGE_LIMIT = 4;
const REVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ELIGIBLE_REVIEW_ORDER_STATES = [
    'PaymentSettled',
    'TestPaymentSettled',
    'PartiallyShipped',
    'Shipped',
    'PartiallyDelivered',
    'Delivered',
];

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
        private readonly assets: AssetService,
        private readonly reviewSettings: StorefrontReviewSettingsService,
        @Optional() private readonly eventBus?: EventBus,
    ) {}

    async findApprovedForProduct(
        ctx: RequestContext,
        productId: ID,
        options: StorefrontReviewListOptions = {},
    ): Promise<StorefrontReviewList> {
        if (!(await this.reviewSettings.get(ctx)).enabled) {
            return { items: [], totalItems: 0, averageRating: 0 };
        }
        const skip = this.boundedInteger(options.skip, 0, 0, 1_000_000);
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
            items: items.map(item => this.shopReview(item, ctx)),
            totalItems,
            averageRating: averageRating ?? 0,
        };
    }

    async findMine(ctx: RequestContext): Promise<StorefrontReview[]> {
        if (!(await this.reviewSettings.get(ctx)).enabled) return [];
        const customer = await this.activeCustomerOrThrow(ctx);
        const reviews = await this.connection.getRepository(ctx, StorefrontReview).find({
            where: { channelId: ctx.channelId, customerId: customer.id },
            order: { createdAt: 'DESC', id: 'DESC' },
        });
        return reviews.map(review => this.shopReview(review, ctx));
    }

    async findCandidates(
        ctx: RequestContext,
        options: StorefrontReviewListOptions = {},
    ): Promise<StorefrontReviewCandidate[]> {
        if (!(await this.reviewSettings.get(ctx)).enabled) return [];
        const skip = this.boundedInteger(options.skip, 0, 0, 1_000_000);
        const take = this.boundedInteger(options.take, 100, 1, 100);
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
                ...(reviewedLineIds.size ? { id: Not(In([...reviewedLineIds])) } : {}),
                order: {
                    customerId: customer.id,
                    salesChannelId: ctx.channelId,
                    state: In(ELIGIBLE_REVIEW_ORDER_STATES),
                },
            },
            relations: {
                order: true,
                productVariant: {
                    translations: true,
                    featuredAsset: true,
                    product: { translations: true, featuredAsset: true },
                },
            },
            order: { order: { orderPlacedAt: 'DESC' }, id: 'DESC' },
            skip,
            take,
        });
        return lines.map(line => {
            const variant = translateDeep(line.productVariant, ctx.languageCode, ['product']);
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
                imageUrl:
                    line.productVariant.featuredAsset?.preview ??
                    variant.product?.featuredAsset?.preview ??
                    null,
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

    async submit(
        ctx: RequestContext,
        input: SubmitStorefrontReviewInput,
        files: Array<Promise<ReviewImageUpload>> = [],
    ): Promise<StorefrontReview> {
        if (!(await this.reviewSettings.get(ctx)).enabled) {
            throw new UserInputError('当前店铺已关闭评价功能');
        }
        const customer = await this.activeCustomerOrThrow(ctx);
        this.validateSubmission(input);
        if (!Array.isArray(files) || files.length > REVIEW_IMAGE_LIMIT) {
            throw new UserInputError('每条评价最多上传 4 张图片');
        }
        await this.lockOrderLine(ctx, input.orderLineId);
        const line = await this.connection.getRepository(ctx, OrderLine).findOne({
            where: {
                id: input.orderLineId,
                order: {
                    customerId: customer.id,
                    salesChannelId: ctx.channelId,
                },
            },
            relations: {
                order: true,
                productVariant: { translations: true, product: { translations: true } },
            },
        });
        if (!line) {
            throw new UserInputError('订单商品不存在或当前账号无权评价');
        }
        const eligible = ELIGIBLE_REVIEW_ORDER_STATES.includes(line.order.state);
        if (!eligible) {
            throw new UserInputError('订单付款成功后即可参与评价');
        }
        const existing = await this.connection.getRepository(ctx, StorefrontReview).findOne({
            where: { orderLineId: line.id },
        });
        if (existing) {
            throw new UserInputError('该订单商品已经提交过评价');
        }
        const variant = translateDeep(line.productVariant, ctx.languageCode, ['product']);
        const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
        const images = await this.createReviewImages(ctx, files);
        let review: StorefrontReview;
        try {
            review = await this.connection.getRepository(ctx, StorefrontReview).save(
                new StorefrontReview({
                    state: 'PENDING',
                    rating: input.rating,
                    title: input.title.trim(),
                    body: input.body.trim(),
                    imageAssets: images,
                    customerName: this.maskCustomerName(customerName || customer.emailAddress),
                    anonymous: input.anonymous === true,
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
        } catch (error) {
            await this.removeReviewImages(ctx, images);
            throw error;
        }
        const saved = await this.getMineOrThrow(ctx, review.id, customer.id);
        await this.publishChanged(ctx, saved, false);
        return saved;
    }

    private async createReviewImages(
        ctx: RequestContext,
        files: Array<Promise<ReviewImageUpload>>,
    ): Promise<Array<{ id: string; preview: string }>> {
        if (!files.length) return [];
        const prepared: Array<{ bytes: Buffer; extension: string; mimeType: string }> = [];
        for (const pendingFile of files) {
            const file = await pendingFile;
            if (!file.mimetype.startsWith('image/')) throw new UserInputError('只能上传图片文件');
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of file.createReadStream()) {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                size += bytes.length;
                if (size > REVIEW_IMAGE_MAX_BYTES) throw new UserInputError('每张评价图片不能超过 5MB');
                chunks.push(bytes);
            }
            const normalized = await processCustomerImage(Buffer.concat(chunks), 'reference');
            const extension = normalized[0] === 0xff ? 'jpg' : normalized[0] === 0x89 ? 'png' : 'webp';
            const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
            prepared.push({ bytes: normalized, extension, mimeType });
        }
        const images: Array<{ id: string; preview: string }> = [];
        try {
            for (const image of prepared) {
                const asset = await this.assets.create(ctx, {
                    file: Promise.resolve({
                        filename: `review.${image.extension}`,
                        mimetype: image.mimeType,
                        createReadStream: () => Readable.from([image.bytes]),
                    }),
                });
                if (!('preview' in asset)) throw new UserInputError('评价图片上传失败，请重试');
                images.push({ id: String(asset.id), preview: asset.preview });
            }
        } catch (error) {
            await this.removeReviewImages(ctx, images);
            throw error;
        }
        return images;
    }

    private async removeReviewImages(
        ctx: RequestContext,
        images: Array<{ id: string; preview: string }>,
    ): Promise<void> {
        if (!images.length) return;
        await this.assets
            .delete(
                ctx,
                images.map(image => image.id),
            )
            .catch(() => undefined);
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
        const repository = this.connection.getRepository(ctx, OrderLine);
        if (['sqlite', 'better-sqlite3', 'sqljs'].includes(this.connection.rawConnection.options.type)) {
            // Acquire SQLite's transaction write lock before checking uniqueness.
            await repository.update({ id: orderLineId }, { id: orderLineId });
            return;
        }
        await repository
            .createQueryBuilder('line')
            .setLock('pessimistic_write')
            .where('line.id = :orderLineId', { orderLineId })
            .getOne();
    }

    private async getMineOrThrow(ctx: RequestContext, id: ID, customerId: ID): Promise<StorefrontReview> {
        const review = await this.connection.getRepository(ctx, StorefrontReview).findOne({
            where: { id, channelId: ctx.channelId, customerId },
        });
        if (!review) {
            throw new EntityNotFoundError(StorefrontReview.name, id);
        }
        return this.shopReview(review, ctx);
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

    private shopReview(review: StorefrontReview, ctx: RequestContext): StorefrontReview {
        const localized = this.localizeMerchantResponse(review, ctx);
        if (localized.anonymous) {
            localized.customerName = String(ctx.languageCode).toLowerCase().startsWith('zh')
                ? '匿名用户'
                : 'Anonymous customer';
        }
        return localized;
    }

    private fulfillmentType(line: OrderLine): 'physical' | 'digital' {
        const lineFields = (line.customFields ?? {}) as { fulfillmentTypeSnapshot?: string };
        const variantFields = (line.productVariant.customFields ?? {}) as { fulfillmentType?: string };
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
