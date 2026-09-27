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
    if (['AddingItems', 'ArrangingPayment'].includes(order.state)) {
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

export const orderStateLabel = orderStateDisplayLabel;

export const fulfillmentStateLabel = fulfillmentStateDisplayLabel;

export function orderStatesForTab(tab: OrderTab): string[] | undefined {
    if (tab === 'pending') return ['AddingItems', 'ArrangingPayment'];
    if (tab === 'shipping') return ['PaymentAuthorized', 'PaymentSettled'];
    if (tab === 'receiving') return ['Shipped', 'PartiallyShipped'];
    if (tab === 'completed') return ['Delivered'];
    return undefined;
}
