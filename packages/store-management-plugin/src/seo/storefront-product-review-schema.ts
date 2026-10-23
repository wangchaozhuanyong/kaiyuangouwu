import { type PublicProductReviewList } from '@vendure/core';

/** Only facts from the same approved public reviews shown on the product page are eligible. */
export function productReviewStructuredData(reviews: PublicProductReviewList): Record<string, unknown> {
    const { totalItems, averageRating, items } = reviews;
    if (
        !Number.isInteger(totalItems) ||
        totalItems <= 0 ||
        !Number.isFinite(averageRating) ||
        averageRating < 1 ||
        averageRating > 5 ||
        items.length === 0
    )
        return {};

    const review = items.flatMap(item => {
        // Anonymous customers contribute to the real aggregate without inventing an author identity.
        if (
            item.anonymous ||
            !item.customerName.trim() ||
            Array.from(item.customerName.trim()).length >= 100 ||
            !Number.isInteger(item.rating) ||
            item.rating < 1 ||
            item.rating > 5 ||
            (!item.title.trim() && !item.body.trim())
        )
            return [];
        const date = new Date(item.createdAt);
        return [
            {
                '@type': 'Review',
                author: { '@type': 'Person', name: item.customerName.trim() },
                reviewRating: {
                    '@type': 'Rating',
                    ratingValue: item.rating,
                    bestRating: 5,
                    worstRating: 1,
                },
                ...(item.title.trim() ? { name: item.title.trim() } : {}),
                ...(item.body.trim() ? { reviewBody: item.body.trim() } : {}),
                ...(Number.isFinite(date.getTime()) ? { datePublished: date.toISOString() } : {}),
            },
        ];
    });
    return {
        aggregateRating: {
            '@type': 'AggregateRating',
            // Match the one-decimal public summary; the count covers all approved reviews, not this page.
            ratingValue: Number(averageRating.toFixed(1)),
            reviewCount: totalItems,
            bestRating: 5,
            worstRating: 1,
        },
        ...(review.length ? { review } : {}),
    };
}
