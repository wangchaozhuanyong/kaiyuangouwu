import type { CustomerServiceReviewRecord } from '../types';
import type { ShopApiContext } from './client-context';

const serviceReviewFields = 'id rating tags comment orderCode revision';
export class StoreNotificationsApi {
    constructor(private readonly request: ShopApiContext['request']) {}
    async recordStorefrontHeartbeat(visitorId: string): Promise<boolean> {
        const result = await this.request<{ recordStorefrontHeartbeat: { recorded: boolean } }>(
            `mutation StorefrontPresence($visitorId: String!) { recordStorefrontHeartbeat(visitorId: $visitorId) { recorded } }`,
            { visitorId },
        );
        return result.recordStorefrontHeartbeat.recorded;
    }

    async currentCustomerServiceReview(
        visitorId: string,
        orderCode?: string,
    ): Promise<CustomerServiceReviewRecord | null> {
        const result = await this.request<{
            currentCustomerServiceReview: CustomerServiceReviewRecord | null;
        }>(
            `query CurrentCustomerServiceReview($visitorId: String!, $orderCode: String) {
                currentCustomerServiceReview(visitorId: $visitorId, orderCode: $orderCode) { ${serviceReviewFields} }
            }`,
            { visitorId, orderCode },
        );
        return result.currentCustomerServiceReview;
    }

    async submitCustomerServiceReview(input: {
        id?: string;
        visitorId: string;
        rating: number;
        tags: string[];
        comment: string;
        orderCode?: string;
    }): Promise<CustomerServiceReviewRecord> {
        const result = await this.request<{ submitCustomerServiceReview: CustomerServiceReviewRecord }>(
            `mutation SubmitCustomerServiceReview($input: SubmitCustomerServiceReviewInput!) { submitCustomerServiceReview(input: $input) { ${serviceReviewFields} } }`,
            { input },
        );
        return result.submitCustomerServiceReview;
    }
}
