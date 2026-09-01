import { describe, expect, it, vi } from 'vitest';

import { StorefrontReviewService } from './storefront-review.service';

function createHarness(
    overrides: {
        orderState?: string;
        fulfillmentType?: 'physical' | 'digital';
        existingReview?: any;
        reviewState?: string;
    } = {},
) {
    const customer = {
        id: 'customer-1',
        firstName: '王',
        lastName: '小明',
        emailAddress: 'customer@example.com',
    } as any;
    const product = { id: 'product-1', name: 'Production guide', translations: [] } as any;
    const variant = {
        id: 'variant-1',
        productId: product.id,
        product,
        name: 'Standard edition',
        sku: 'GUIDE-1',
        translations: [],
        customFields: { fulfillmentType: overrides.fulfillmentType ?? 'physical' },
    } as any;
    const order = {
        id: 'order-1',
        state: overrides.orderState ?? 'Delivered',
        customerId: customer.id,
        channels: [{ id: 'channel-1' }],
    } as any;
    const line = {
        id: 'line-1',
        order,
        productVariant: variant,
        customFields: { fulfillmentTypeSnapshot: overrides.fulfillmentType ?? 'physical' },
    } as any;
    let savedReview: any;
    const reviewRepository = {
        findOne: vi.fn((options: any) => {
            if (options.where.orderLineId) return Promise.resolve(overrides.existingReview ?? null);
            if (!savedReview) return Promise.resolve(null);
            return Promise.resolve({ ...savedReview, state: overrides.reviewState ?? savedReview.state });
        }),
        find: vi.fn().mockResolvedValue([]),
        findAndCount: vi.fn().mockResolvedValue([[], 0]),
        average: vi.fn().mockResolvedValue(4.5),
        save: vi.fn((review: any) => {
            savedReview = { ...review, id: 'review-1', createdAt: new Date(), updatedAt: new Date() };
            return Promise.resolve(savedReview);
        }),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const orderLineQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(line),
    };
    const orderLineRepository = {
        createQueryBuilder: vi.fn().mockReturnValue(orderLineQueryBuilder),
        findOne: vi.fn().mockResolvedValue(line),
        find: vi.fn().mockResolvedValue([line]),
    };
    const connection = {
        getRepository: vi.fn((_ctx: any, entity: any) => {
            if (entity.name === 'StorefrontReview') return reviewRepository;
            if (entity.name === 'OrderLine') return orderLineRepository;
            throw new Error(`Unexpected entity ${entity.name}`);
        }),
    };
    const customerService = { findOneByUserId: vi.fn().mockResolvedValue(customer) };
    const translations = {
        prepareLocalizedFields: vi.fn(fields =>
            Promise.resolve(
                fields.map((field: any) => ({
                    path: field.path,
                    sourceText: field.sourceText,
                    translatedText: `translated-${field.path}`,
                    status: 'AUTO_TRANSLATED',
                    origin: 'AUTO',
                    locked: false,
                })),
            ),
        ),
        recordPreparedFields: vi.fn(() => Promise.resolve(undefined)),
    };
    const service = new StorefrontReviewService(
        connection as any,
        customerService as any,
        translations as any,
    );
    const ctx = {
        activeUserId: 'user-1',
        channelId: 'channel-1',
        channel: { id: 'channel-1' },
        languageCode: 'en',
    } as any;
    return { service, ctx, reviewRepository, orderLineQueryBuilder };
}

const validInput = {
    orderLineId: 'line-1',
    rating: 5,
    title: 'Very useful',
    body: 'The guide was clear, practical, and easy to follow.',
};

describe('StorefrontReviewService', () => {
    it('returns an exact database aggregate for public product ratings', async () => {
        const test = createHarness();

        await expect(test.service.findApprovedForProduct(test.ctx, 'product-1')).resolves.toMatchObject({
            items: [],
            totalItems: 0,
            averageRating: 4.5,
        });
    });

    it('searches the admin review queue across content, customer, product and SKU', async () => {
        const test = createHarness();

        await test.service.findForAdmin(test.ctx, { state: 'PENDING', search: ' keyboard ' });

        const options = test.reviewRepository.findAndCount.mock.calls[0][0];
        expect(options.where).toHaveLength(5);
        expect(options.where).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ title: expect.objectContaining({ _type: 'like' }) }),
                expect.objectContaining({ body: expect.objectContaining({ _type: 'like' }) }),
                expect.objectContaining({ customerName: expect.objectContaining({ _type: 'like' }) }),
                expect.objectContaining({ productName: expect.objectContaining({ _type: 'like' }) }),
                expect.objectContaining({ sku: expect.objectContaining({ _type: 'like' }) }),
            ]),
        );
    });

    it('finds review candidates independently of the account order preview limit', async () => {
        const test = createHarness();

        await expect(test.service.findCandidates(test.ctx)).resolves.toEqual([
            expect.objectContaining({
                orderLineId: 'line-1',
                orderId: 'order-1',
                productId: 'product-1',
                productName: 'Production guide',
                fulfillmentType: 'physical',
            }),
        ]);
    });

    it('creates a verified pending review from a customer-owned delivered order line', async () => {
        const test = createHarness();

        const result = await test.service.submit(test.ctx, validInput);

        expect(result).toMatchObject({
            id: 'review-1',
            state: 'PENDING',
            rating: 5,
            productId: 'product-1',
            orderLineId: 'line-1',
        });
        expect(result.customerName).toBe('王***明');
        expect(test.orderLineQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('requires physical orders to be delivered', async () => {
        const test = createHarness({ orderState: 'Shipped' });

        await expect(test.service.submit(test.ctx, validInput)).rejects.toThrow(
            '实物商品需在订单完成后才能评价',
        );
    });

    it('allows paid digital products to be reviewed', async () => {
        const test = createHarness({ fulfillmentType: 'digital', orderState: 'PaymentSettled' });

        await expect(test.service.submit(test.ctx, validInput)).resolves.toMatchObject({ state: 'PENDING' });
    });

    it('prevents duplicate reviews for the same order line', async () => {
        const test = createHarness({ existingReview: { id: 'existing-review' } });

        await expect(test.service.submit(test.ctx, validInput)).rejects.toThrow('该订单商品已经提交过评价');
    });

    it('uses guarded moderation and requires a rejection reason', async () => {
        const test = createHarness({ reviewState: 'PENDING' });
        await test.service.submit(test.ctx, validInput);

        await expect(
            test.service.moderate(test.ctx, { id: 'review-1', state: 'REJECTED', response: '' }),
        ).rejects.toThrow('驳回评价时请填写');

        await test.service.moderate(test.ctx, {
            id: 'review-1',
            state: 'APPROVED',
            response: '感谢您的真实反馈。',
        });
        expect(test.reviewRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'review-1', state: 'PENDING' }),
            expect.objectContaining({ state: 'APPROVED', merchantResponse: '感谢您的真实反馈。' }),
        );
    });

    it('does not expose a legacy Chinese merchant response to an English client', () => {
        const test = createHarness();
        const review = {
            merchantResponse: '旧中文回复',
            merchantResponseZh: '旧中文回复',
            merchantResponseEn: '仍然是中文回复',
        };

        expect(
            (test.service as any).localizeMerchantResponse(review, {
                languageCode: 'en',
            }).merchantResponse,
        ).toBeNull();
    });
});
