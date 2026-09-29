import { Check, Copy, Package } from 'lucide-react';
import { useState } from 'react';

import { formatBusinessDate } from '../business-time';
import { Order, OrderSummary, StorefrontLanguage } from '../types';

import { SafeImage } from './product-display';

export type DeliveryStatus = 'preparing' | 'transit' | 'delivered' | 'cancelled';
export type DeliveryFilter = 'all' | DeliveryStatus;

export function physicalDeliveryLines(order: OrderSummary) {
    return order.lines.filter(
        line =>
            (line.customFields.fulfillmentTypeSnapshot ??
                line.productVariant.customFields.fulfillmentType) !== 'digital',
    );
}

export function physicalFulfillments<T extends { method: string }>(fulfillments: T[] = []) {
    return fulfillments.filter(
        item =>
            ![
                'digital-fulfillment',
                'manual-digital-service',
                'manual-service-fulfillment',
                'auto-card-email',
                'auto-card-fulfillment',
            ].includes(item.method.trim().toLowerCase()),
    );
}

export function deliveryStatus(order: OrderSummary): DeliveryStatus {
    const fulfillments = physicalFulfillments(order.fulfillments ?? []);
    const active = fulfillments.filter(item => item.state !== 'Cancelled');
    if (order.state === 'Cancelled') return 'cancelled';
    if (
        ['PartiallyShipped', 'PartiallyDelivered'].includes(order.state) ||
        active.some(item => item.state === 'Shipped')
    )
        return 'transit';
    if (
        order.state === 'Delivered' ||
        (active.length > 0 && active.every(item => item.state === 'Delivered'))
    )
        return 'delivered';
    if (order.state === 'Shipped') return 'transit';
    if (fulfillments.length && !active.length) return 'cancelled';
    return 'preparing';
}

export function deliveryLabel(status: DeliveryStatus, language: StorefrontLanguage) {
    return {
        preparing: ['待发货', 'Preparing'],
        transit: ['运输中', 'In transit'],
        delivered: ['已送达', 'Delivered'],
        cancelled: ['已取消', 'Cancelled'],
    }[status][language === 'zh' ? 0 : 1];
}

export function deliveryUpdatedAt(order: OrderSummary) {
    return (
        physicalFulfillments(order.fulfillments ?? [])
            .map(item => item.updatedAt)
            .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? order.orderPlacedAt
    );
}

export function deliveryDate(value: string | null | undefined, locale: string) {
    return value
        ? formatBusinessDate(locale, value, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
          })
        : '—';
}

export function DeliveryBadge({
    status,
    language,
    partial = false,
}: {
    status: DeliveryStatus;
    language: StorefrontLanguage;
    partial?: boolean;
}) {
    return (
        <span className={`delivery-badge is-${status}`}>
            <span aria-hidden="true" />
            {partial
                ? language === 'zh'
                    ? '部分发货'
                    : 'Partially shipped'
                : deliveryLabel(status, language)}
        </span>
    );
}

export function DeliveryProducts({ order, language }: { order: OrderSummary; language: StorefrontLanguage }) {
    const lines = physicalDeliveryLines(order);
    return (
        <div className="delivery-products">
            {lines.map(line => {
                const src =
                    line.productVariant.featuredAsset?.preview ??
                    line.productVariant.product.featuredAsset?.preview;
                return (
                    <div className="delivery-product" key={line.id}>
                        {src ? (
                            <SafeImage
                                src={src}
                                alt={line.productVariant.name}
                                imageKind="thumbnail"
                                loading="lazy"
                            />
                        ) : (
                            <span
                                className="delivery-image-empty"
                                aria-label={language === 'zh' ? '暂无商品图片' : 'No product image'}
                            >
                                <Package aria-hidden="true" />
                            </span>
                        )}
                        <span className="delivery-product-name" title={line.productVariant.name}>
                            {line.productVariant.name}
                        </span>
                        <small>×{line.quantity}</small>
                    </div>
                );
            })}
        </div>
    );
}

export function TrackingCode({ code, language }: { code?: string | null; language: StorefrontLanguage }) {
    const [result, setResult] = useState<'copied' | 'failed' | null>(null);
    const zh = language === 'zh';
    return (
        <div className="delivery-tracking-code">
            <code>{code || (zh ? '暂无运单号' : 'No tracking number')}</code>
            {code && (
                <button
                    type="button"
                    onClick={() => {
                        void (async () => {
                            try {
                                await navigator.clipboard.writeText(code);
                                setResult('copied');
                            } catch {
                                setResult('failed');
                            }
                        })();
                    }}
                    aria-label={zh ? '复制运单号' : 'Copy tracking number'}
                >
                    {result === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                </button>
            )}
            {result && (
                <small role="status">
                    {result === 'copied'
                        ? zh
                            ? '已复制'
                            : 'Copied'
                        : zh
                          ? '复制失败，请手动选择单号'
                          : 'Copy failed. Select the number to copy.'}
                </small>
            )}
        </div>
    );
}

export function DeliveryDetails({
    order,
    locale,
    language,
}: {
    order: Order;
    locale: string;
    language: StorefrontLanguage;
}) {
    const zh = language === 'zh';
    const fulfillments = physicalFulfillments(order.fulfillments ?? []);
    const [selectedId, setSelectedId] = useState(fulfillments[0]?.id);
    const current = fulfillments.find(item => item.id === selectedId) ?? fulfillments[0];
    const evidence = current?.deliveryEvidence;
    const events = [...(evidence?.events ?? [])].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    const status = current
        ? deliveryStatus({ ...order, state: current.state, fulfillments: [current] })
        : deliveryStatus(order);
    return (
        <div className="delivery-details">
            {fulfillments.length > 1 && (
                <div
                    className="delivery-package-switch"
                    role="group"
                    aria-label={zh ? '选择包裹' : 'Select package'}
                >
                    {fulfillments.map((item, index) => (
                        <button
                            type="button"
                            key={item.id}
                            aria-pressed={item.id === current?.id}
                            onClick={() => setSelectedId(item.id)}
                        >
                            {zh ? `包裹 ${index + 1}` : `Package ${index + 1}`}
                            <small>
                                {item.deliveryEvidence?.status === 'EXCEPTION'
                                    ? zh
                                        ? '配送异常'
                                        : 'Delivery exception'
                                    : deliveryLabel(
                                          deliveryStatus({
                                              ...order,
                                              state: item.state,
                                              fulfillments: [item],
                                          }),
                                          language,
                                      )}
                            </small>
                        </button>
                    ))}
                </div>
            )}
            <div className="delivery-detail-heading">
                <div>
                    <span className="delivery-eyebrow">{zh ? '当前配送状态' : 'Delivery status'}</span>
                    <h2>
                        {evidence?.status === 'EXCEPTION'
                            ? zh
                                ? '配送异常'
                                : 'Delivery exception'
                            : deliveryLabel(status, language)}
                    </h2>
                    <p>
                        {current
                            ? zh
                                ? '按已记录的包裹信息展示'
                                : 'Based on recorded shipment information'
                            : zh
                              ? '商家尚未创建配送包裹'
                              : 'The merchant has not created a shipment yet'}
                    </p>
                </div>
                <Package aria-hidden="true" />
            </div>
            <dl className="delivery-facts">
                <div>
                    <dt>{zh ? '配送方式 / 承运商' : 'Method / carrier'}</dt>
                    <dd>
                        {evidence?.carrier ||
                            current?.method ||
                            order.checkoutShipping?.methodName ||
                            (zh ? '待安排' : 'Pending')}
                    </dd>
                </div>
                <div>
                    <dt>{zh ? '运单号' : 'Tracking number'}</dt>
                    <dd>
                        <TrackingCode
                            key={current?.id ?? 'pending'}
                            code={evidence?.trackingCode || current?.trackingCode}
                            language={language}
                        />
                    </dd>
                </div>
                <div>
                    <dt>{zh ? '更新时间' : 'Updated'}</dt>
                    <dd>{deliveryDate(current?.updatedAt ?? order.orderPlacedAt, locale)}</dd>
                </div>
            </dl>
            {evidence?.exceptionReason && (
                <p className="delivery-exception" role="status">
                    {evidence.exceptionReason}
                </p>
            )}
            <section className="delivery-events">
                <h3>{zh ? '配送记录' : 'Delivery history'}</h3>
                <p>
                    {events.length
                        ? zh
                            ? '按最新记录在前排列'
                            : 'Latest update first'
                        : zh
                          ? '暂无详细配送轨迹，以下为已确认的订单与包裹记录。'
                          : 'Detailed tracking is not available. Confirmed order and shipment records are shown below.'}
                </p>
                <ol>
                    {events.length
                        ? events.map(event => (
                              <li key={event.id}>
                                  <time dateTime={event.createdAt}>
                                      {deliveryDate(event.createdAt, locale)}
                                  </time>
                                  <div>
                                      <strong>
                                          {event.status === 'EXCEPTION'
                                              ? zh
                                                  ? '配送异常'
                                                  : 'Delivery exception'
                                              : event.status === 'DELIVERED'
                                                ? zh
                                                    ? '已送达'
                                                    : 'Delivered'
                                                : zh
                                                  ? '运输信息更新'
                                                  : 'Delivery update'}
                                      </strong>
                                      {event.note && <p>{event.note}</p>}
                                      <small>
                                          {event.actorType === 'CUSTOMER'
                                              ? zh
                                                  ? '买家确认'
                                                  : 'Customer update'
                                              : event.actorType === 'ADMIN'
                                                ? zh
                                                    ? '商家更新'
                                                    : 'Merchant update'
                                                : zh
                                                  ? '系统记录'
                                                  : 'System record'}
                                      </small>
                                  </div>
                              </li>
                          ))
                        : current && (
                              <li>
                                  <time dateTime={current.updatedAt}>
                                      {deliveryDate(current.updatedAt, locale)}
                                  </time>
                                  <div>
                                      <strong>{deliveryLabel(status, language)}</strong>
                                      <p>{zh ? '包裹当前状态' : 'Current shipment status'}</p>
                                  </div>
                              </li>
                          )}
                    {order.orderPlacedAt && (
                        <li>
                            <time dateTime={order.orderPlacedAt}>
                                {deliveryDate(order.orderPlacedAt, locale)}
                            </time>
                            <div>
                                <strong>{zh ? '订单已创建' : 'Order placed'}</strong>
                                <p>{order.code}</p>
                            </div>
                        </li>
                    )}
                </ol>
            </section>
        </div>
    );
}
