import { getStatusLabel } from '../../utils/status-labels';

export interface SalesAddress {
  fullName?: string | null;
  company?: string | null;
  streetLine1?: string | null;
  streetLine2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  phoneNumber?: string | null;
}

export interface FulfillmentLineLike {
  orderLineId: string;
  quantity: number;
}

export interface FulfillmentLike {
  state: string;
  lines: FulfillmentLineLike[];
}

export interface OrderLineLike {
  id: string;
  quantity: number;
  customFields?: {
    fulfillmentTypeSnapshot?: string | null;
  } | null;
  productVariant?: {
    customFields?: {
      fulfillmentType?: string | null;
    } | null;
  } | null;
}

export interface FulfillableOrderLike {
  lines: OrderLineLike[];
  fulfillments?: FulfillmentLike[] | null;
}

export interface GraphqlMutationResult {
  __typename?: string;
  errorCode?: string;
  message?: string;
  transitionError?: string;
}

export const orderStateLabels: Record<string, string> = {
  AddingItems: '购物车中',
  Draft: '草稿订单',
  ArrangingPayment: '待支付',
  PaymentAuthorized: '支付已授权',
  PaymentSettled: '待履约',
  PartiallyShipped: '部分发货',
  Shipped: '已发货',
  PartiallyDelivered: '部分交付',
  Delivered: '已完成',
  Modifying: '修改中',
  ArrangingAdditionalPayment: '待补款',
  Cancelled: '已取消',
};

export const getOrderStateLabel = (state: string) => orderStateLabels[state] ?? getStatusLabel(state);

export const getOrderStateClass = (state: string) => {
  if (state === 'Delivered') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (state === 'Shipped' || state === 'PartiallyShipped') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (state === 'PaymentSettled' || state === 'PaymentAuthorized') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (state === 'Cancelled') return 'border-slate-200 bg-slate-100 text-slate-600';
  return 'border-violet-200 bg-violet-50 text-violet-700';
};

export const formatMoney = (amount: number, currencyCode: string) => {
  try {
    const digits = new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount / 10 ** digits);
  } catch {
    return `${currencyCode} ${amount}`;
  }
};

export const moneyToMajorInput = (amount: number, currencyCode: string) => {
  try {
    const digits = new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits ?? 2;
    return (amount / 10 ** digits).toFixed(digits);
  } catch {
    return String(amount);
  }
};

export const majorInputToMoney = (value: string, currencyCode: string) => {
  const normalized = value.trim().replace(/,/g, '');
  const numericValue = Number(normalized);
  if (!normalized || !Number.isFinite(numericValue) || numericValue < 0) return null;
  try {
    const digits = new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits ?? 2;
    const scaled = numericValue * 10 ** digits;
    return Number.isInteger(scaled) ? scaled : Math.round(scaled);
  } catch {
    return Number.isInteger(numericValue) ? numericValue : null;
  }
};

export const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

export const formatAddress = (address?: SalesAddress | null) => {
  if (!address) return '未填写收货地址';
  return [
    address.province,
    address.city,
    address.streetLine1,
    address.streetLine2,
    address.postalCode,
  ].filter(Boolean).join(' ') || '未填写详细地址';
};

export const getCustomerName = (customer?: {
  firstName?: string | null;
  lastName?: string | null;
  emailAddress?: string | null;
} | null) => {
  const fullName = [customer?.lastName, customer?.firstName].filter(Boolean).join('');
  return fullName || customer?.emailAddress || '游客订单';
};

export const getMutationError = (result?: GraphqlMutationResult | null) => {
  if (!result) return '后端未返回处理结果';
  return result.transitionError || result.message || result.errorCode || '操作未成功';
};

export const getRemainingPhysicalLines = (order: FulfillableOrderLike) => {
  const fulfilledQuantities = new Map<string, number>();
  for (const fulfillment of order.fulfillments ?? []) {
    if (fulfillment.state === 'Cancelled') continue;
    for (const line of fulfillment.lines ?? []) {
      fulfilledQuantities.set(
        line.orderLineId,
        (fulfilledQuantities.get(line.orderLineId) ?? 0) + line.quantity,
      );
    }
  }

  return order.lines.flatMap(line => {
    const fulfillmentType = line.customFields?.fulfillmentTypeSnapshot
      ?? line.productVariant?.customFields?.fulfillmentType
      ?? 'physical';
    if (fulfillmentType !== 'physical') return [];
    const quantity = Math.max(0, line.quantity - (fulfilledQuantities.get(line.id) ?? 0));
    return quantity > 0 ? [{ orderLineId: line.id, quantity }] : [];
  });
};

export const getOrderFulfillmentKind = (order: FulfillableOrderLike) => {
  const kinds = new Set(order.lines.map(line => (
    line.customFields?.fulfillmentTypeSnapshot
      ?? line.productVariant?.customFields?.fulfillmentType
      ?? 'physical'
  )));
  if (kinds.size > 1) return 'MIXED';
  return kinds.has('digital') ? 'DIGITAL' : 'PHYSICAL';
};
