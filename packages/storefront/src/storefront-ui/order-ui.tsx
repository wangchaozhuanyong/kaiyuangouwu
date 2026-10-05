import {
    fulfillmentStateDisplayLabel,
    orderStateDisplayLabel,
} from '../../../common/src/display-localization';
import { formatBusinessDate } from '../business-time';
import { OrderTab } from '../storefront-router';
import {
    AfterSalesRequest,
    CustomerAddress,
    OrderSummary,
    StoreCustomerCoupon,
    StorefrontLanguage,
} from '../types';

export function customerCouponStatusLabel(
    status: StoreCustomerCoupon['status'],
    language: StorefrontLanguage,
) {
    const labels =
        language === 'zh'
            ? {
                  AVAILABLE: '未使用',
                  LOCKED: '订单占用中',
                  USED: '已核销',
                  RETURNED: '已返还，未使用',
                  EXPIRED: '已过期',
                  REVOKED: '已撤销',
              }
            : {
                  AVAILABLE: 'Available',
                  LOCKED: 'Reserved by order',
                  USED: 'Used',
                  RETURNED: 'Returned, unused',
                  EXPIRED: 'Expired',
                  REVOKED: 'Revoked',
              };
    return labels[status];
}

export function afterSalesNotification(
    request: AfterSalesRequest,
    language: StorefrontLanguage,
): { title: string; detail: string; tone: 'pending' | 'progress' | 'complete' | 'muted' } {
    const isZh = language === 'zh';
    const titleByState: Record<AfterSalesRequest['state'], string> = {
        PENDING: isZh ? '售后申请等待处理' : 'Return request awaiting review',
        APPROVED: isZh ? '售后申请已通过' : 'Return request approved',
        REJECTED: isZh ? '售后申请未通过' : 'Return request declined',
        CANCELLED: isZh ? '售后申请已撤销' : 'Return request cancelled',
        COMPLETED: isZh ? '售后处理已完成' : 'Return request completed',
    };
    return {
        title: titleByState[request.state],
        detail: isZh
            ? `申请 ${request.code} · 订单 ${request.order.code}`
            : `${request.code} · Order ${request.order.code}`,
        tone:
            request.state === 'PENDING'
                ? 'pending'
                : request.state === 'APPROVED'
                  ? 'progress'
                  : request.state === 'COMPLETED'
                    ? 'complete'
                    : 'muted',
    };
}

export function orderNotification(
    order: OrderSummary,
    language: StorefrontLanguage,
): { title: string; detail: string; tone: 'pending' | 'progress' | 'complete' | 'muted' } {
    const isZh = language === 'zh';
    if (order.state === 'AddingItems') {
        return {
            title: isZh ? '商品仍在购物车' : 'Items are still in the cart',
            detail: isZh
                ? `购物车 ${order.code} 尚未提交结算`
                : `Cart ${order.code} has not been checked out`,
            tone: 'muted',
        };
    }
    if (order.state === 'ArrangingAdditionalPayment') {
        return {
            title: isZh ? '订单等待补款' : 'Order awaiting additional payment',
            detail: isZh
                ? `订单 ${order.code} 已调整，请核对补款金额后继续支付`
                : `Order ${order.code} was updated. Review the additional amount before paying.`,
            tone: 'pending',
        };
    }
    if (order.state === 'Modifying') {
        return {
            title: isZh ? '商家正在调整订单' : 'The merchant is updating your order',
            detail: isZh
                ? `请等待订单 ${order.code} 调整完成`
                : `Wait for the update to ${order.code} to finish.`,
            tone: 'progress',
        };
    }
    if (order.state === 'ArrangingPayment') {
        return {
            title: isZh ? '订单等待支付' : 'Order awaiting payment',
            detail: isZh ? `订单 ${order.code} 已保留，可继续支付或修改` : `Order ${order.code} is saved`,
            tone: 'pending',
        };
    }
    if (['PaymentAuthorized', 'PaymentSettled'].includes(order.state)) {
        return {
            title: order.checkoutFulfillment?.containsDigitalProducts
                ? isZh
                    ? '数字商品正在处理中'
                    : 'Digital order processing has started'
                : isZh
                  ? '商家正在准备订单'
                  : 'Your order is being prepared',
            detail: isZh ? `查看订单 ${order.code} 的最新状态` : `View the latest status for ${order.code}`,
            tone: 'progress',
        };
    }
    if (['Shipped', 'PartiallyShipped'].includes(order.state)) {
        return {
            title: isZh ? '订单已发货' : 'Order shipped',
            detail: isZh ? `订单 ${order.code} 已有物流更新` : `Tracking is available for ${order.code}`,
            tone: 'progress',
        };
    }
    if (order.state === 'Delivered') {
        return {
            title: isZh ? '订单已完成' : 'Order completed',
            detail: isZh ? `订单 ${order.code} 已完成交付` : `Order ${order.code} was delivered`,
            tone: 'complete',
        };
    }
    return {
        title: order.state === 'Cancelled' ? (isZh ? '订单已取消' : 'Order cancelled') : order.state,
        detail: isZh ? `查看订单 ${order.code}` : `View order ${order.code}`,
        tone: 'muted',
    };
}

export function formatOrderDate(value: string | null | undefined, locale: string): string {
    if (!value) return '--';
    return formatBusinessDate(locale, value, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function addressText(address: CustomerAddress): string {
    return [address.province, address.city, address.streetLine1, address.streetLine2, address.postalCode]
        .filter(Boolean)
        .join(' ');
}

export function orderStateLabel(state: string, language: StorefrontLanguage): string {
    const customerLabels: Record<string, [string, string]> = {
        AddingItems: ['购物车中', 'In cart'],
        ArrangingAdditionalPayment: ['待补款', 'Additional payment needed'],
        Modifying: ['商家调整中', 'Order being updated'],
    };
    return customerLabels[state]?.[language === 'zh' ? 0 : 1] ?? orderStateDisplayLabel(state, language);
}

export const fulfillmentStateLabel = fulfillmentStateDisplayLabel;

/** Business delivery labels do not claim that an email was received or content was claimed. */
export function customerOrderStateLabel(
    order: Pick<OrderSummary, 'state' | 'lines'>,
    language: StorefrontLanguage,
) {
    const allDigital =
        order.lines.length > 0 &&
        order.lines.every(
            line =>
                (line.customFields.fulfillmentTypeSnapshot ??
                    line.productVariant.customFields.fulfillmentType) === 'digital',
        );
    if (allDigital) {
        const labels: Record<string, [string, string]> = {
            PaymentAuthorized: ['待确认收款', 'Awaiting payment settlement'],
            PaymentSettled: ['待交付', 'Preparing digital delivery'],
            PartiallyShipped: ['部分交付', 'Partially delivered'],
            Shipped: ['交付进行中', 'Delivery in progress'],
            PartiallyDelivered: ['部分交付', 'Partially delivered'],
            Delivered: ['已交付', 'Delivered'],
        };
        const label = labels[order.state];
        if (label) return label[language === 'zh' ? 0 : 1];
    }
    return orderStateLabel(order.state, language);
}

export function orderStatesForTab(tab: OrderTab): string[] | undefined {
    if (tab === 'pending') return ['ArrangingPayment', 'ArrangingAdditionalPayment'];
    if (tab === 'shipping') return ['PaymentAuthorized', 'PaymentSettled'];
    if (tab === 'receiving') return ['Shipped', 'PartiallyShipped'];
    if (tab === 'completed') return ['Delivered'];
    return undefined;
}
