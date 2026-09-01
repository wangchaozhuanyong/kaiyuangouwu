import { describe, expect, it } from 'vitest';
import type { OrderListSummaryInput } from './sales-utils';
import { summarizeOrderListItem } from './sales-utils';

const physicalLine = (overrides: Partial<OrderListSummaryInput['lines'][number]> = {}) => ({
    id: 'line-physical',
    quantity: 2,
    productVariant: {
        name: '经典棉质衬衫',
        sku: 'SHIRT-WHITE-M',
        options: [{ name: '白色' }, { name: 'M' }],
        customFields: { fulfillmentType: 'physical' },
    },
    ...overrides,
});

const digitalLine = (overrides: Partial<OrderListSummaryInput['lines'][number]> = {}) => ({
    id: 'line-digital',
    quantity: 1,
    productVariant: {
        name: '年度会员兑换码',
        sku: 'MEMBER-ANNUAL',
        options: [{ name: '一年期' }],
        customFields: { fulfillmentType: 'digital' },
    },
    ...overrides,
});

const createOrder = (overrides: Partial<OrderListSummaryInput> = {}): OrderListSummaryInput => ({
    state: 'PaymentSettled',
    totalQuantity: 2,
    lines: [physicalLine()],
    customer: {
        firstName: '三',
        lastName: '张',
        emailAddress: 'buyer@example.com',
        phoneNumber: '13800000000',
    },
    shippingAddress: {
        province: '广东省',
        city: '深圳市',
        streetLine1: '南山区科技园 1 号',
        postalCode: '518000',
    },
    fulfillments: [],
    ...overrides,
});

describe('summarizeOrderListItem', () => {
    it('拆出单件实物订单的商品、规格、买家和履约信息', () => {
        expect(summarizeOrderListItem(createOrder())).toEqual({
            productName: '经典棉质衬衫',
            additionalLineCount: 0,
            specification: '白色 / M',
            sku: 'SHIRT-WHITE-M',
            quantity: 2,
            customerName: '张三',
            contact: 'buyer@example.com',
            shippingAddress: '广东省 深圳市 南山区科技园 1 号 518000',
            fulfillmentKind: 'PHYSICAL',
            fulfillmentLabel: '2 件待发',
            remainingPhysicalQuantity: 2,
        });
    });

    it('虚拟订单没有地址和实物履约要求', () => {
        const longEmail = 'very-long-customer-contact-address@example.invalid';
        const summary = summarizeOrderListItem(
            createOrder({
                totalQuantity: 1,
                lines: [digitalLine()],
                customer: { emailAddress: longEmail },
                shippingAddress: null,
            }),
        );

        expect(summary.fulfillmentKind).toBe('DIGITAL');
        expect(summary.fulfillmentLabel).toBe('无需履约');
        expect(summary.shippingAddress).toBe('-');
        expect(summary.contact).toBe(longEmail);
    });

    it('多商品混合订单只摘要首项并保留总购买数量', () => {
        const summary = summarizeOrderListItem(
            createOrder({
                totalQuantity: 3,
                lines: [physicalLine(), digitalLine()],
                shippingAddress: null,
            }),
        );

        expect(summary.productName).toBe('经典棉质衬衫');
        expect(summary.additionalLineCount).toBe(1);
        expect(summary.quantity).toBe(3);
        expect(summary.fulfillmentKind).toBe('MIXED');
        expect(summary.shippingAddress).toBe('未填写收货地址');
        expect(summary.fulfillmentLabel).toBe('2 件待发');
    });

    it('已完成实物履约时不再显示待发数量', () => {
        const summary = summarizeOrderListItem(
            createOrder({
                state: 'Shipped',
                fulfillments: [
                    {
                        state: 'Shipped',
                        lines: [{ orderLineId: 'line-physical', quantity: 2 }],
                    },
                ],
            }),
        );

        expect(summary.remainingPhysicalQuantity).toBe(0);
        expect(summary.fulfillmentLabel).toBe('已发货');
    });

    it('缺少客户资料时使用稳定占位值，并保留长地址原文', () => {
        const longAddress = '超长地址'.repeat(30);
        const summary = summarizeOrderListItem(
            createOrder({
                customer: null,
                shippingAddress: { streetLine1: longAddress },
            }),
        );

        expect(summary.customerName).toBe('游客订单');
        expect(summary.contact).toBe('未留联系方式');
        expect(summary.shippingAddress).toBe(longAddress);
    });
});
