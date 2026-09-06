import { gql } from '@apollo/client';

export const REFERRAL_TODAY_WIDGET_QUERY = gql`
    query NextAdminReferralTodayWidget {
        referralTodayMetrics {
            businessDate
            visitorCount
            newCustomerCount
            consumerCount
            firstTimeConsumerCount
            returningConsumerCount
            orderCount
            todayInvitedCount
            todayInvitedPurchaserCount
            salesByCurrency {
                currencyCode
                sales
            }
        }
    }
`;

export const STALE_TRANSLATION_ALERT_QUERY = gql`
    query NextAdminStaleTranslationAlert {
        contentTranslationStaleCount
    }
`;

export interface ReferralTodayWidgetData {
    referralTodayMetrics: {
        businessDate: string;
        visitorCount: number | null;
        newCustomerCount: number;
        consumerCount: number;
        firstTimeConsumerCount: number;
        returningConsumerCount: number;
        orderCount: number;
        todayInvitedCount: number;
        todayInvitedPurchaserCount: number;
        salesByCurrency: Array<{ currencyCode: string; sales: number }>;
    };
}

export interface StaleTranslationAlertData {
    contentTranslationStaleCount: number;
}
