import { Injectable } from '@nestjs/common';
import {
    ActiveOrderService,
    Customer,
    CustomerService,
    ID,
    Order,
    OrderService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { CustomerDeliveryEmail } from './entities/customer-delivery-email.entity';

export interface SaveCustomerDeliveryEmailInput {
    emailAddress: string;
    confirmEmailAddress: string;
    label?: string | null;
    isDefault?: boolean | null;
}

export interface SetActiveOrderDeliveryEmailInput {
    contactId?: ID | null;
    emailAddress?: string | null;
    confirmEmailAddress?: string | null;
    label?: string | null;
    saveToAddressBook?: boolean | null;
    isDefault?: boolean | null;
}

@Injectable()
export class CustomerDeliveryEmailService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly activeOrderService: ActiveOrderService,
        private readonly orderService: OrderService,
        private readonly customerService: CustomerService,
    ) {}

    async listMine(ctx: RequestContext): Promise<CustomerDeliveryEmail[]> {
        const customer = await this.activeCustomer(ctx);
        return this.connection.getRepository(ctx, CustomerDeliveryEmail).find({
            where: { channelId: ctx.channelId, customerId: customer.id },
            order: { isDefault: 'DESC', createdAt: 'ASC' },
        });
    }

    async saveMine(
        ctx: RequestContext,
        input: SaveCustomerDeliveryEmailInput,
    ): Promise<CustomerDeliveryEmail> {
        const customer = await this.activeCustomer(ctx);
        const emailAddress = normalizeEmail(input.emailAddress);
        const confirmation = normalizeEmail(input.confirmEmailAddress);
        if (emailAddress !== confirmation) {
            throw new UserInputError('两次输入的交付邮箱不一致');
        }
        const repository = this.connection.getRepository(ctx, CustomerDeliveryEmail);
        const existing = await repository.findOne({
            where: { channelId: ctx.channelId, customerId: customer.id, normalizedEmail: emailAddress },
        });
        const count = await repository.count({
            where: { channelId: ctx.channelId, customerId: customer.id },
        });
        const shouldDefault = Boolean(input.isDefault) || count === 0;
        if (shouldDefault) {
            await repository
                .createQueryBuilder()
                .update(CustomerDeliveryEmail)
                .set({ isDefault: false })
                .where('channelId = :channelId AND customerId = :customerId', {
                    channelId: ctx.channelId,
                    customerId: customer.id,
                })
                .execute();
        }
        const entity =
            existing ??
            new CustomerDeliveryEmail({
                channelId: ctx.channelId,
                customerId: customer.id,
                emailAddress,
                normalizedEmail: emailAddress,
                confirmedAt: new Date(),
                label: '',
                isDefault: false,
            });
        entity.emailAddress = emailAddress;
        entity.label = normalizeLabel(input.label);
        entity.isDefault = shouldDefault || entity.isDefault;
        entity.confirmedAt = new Date();
        return repository.save(entity);
    }

    async setDefaultMine(ctx: RequestContext, id: ID): Promise<CustomerDeliveryEmail> {
        const customer = await this.activeCustomer(ctx);
        const repository = this.connection.getRepository(ctx, CustomerDeliveryEmail);
        const entity = await repository.findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id },
        });
        if (!entity) throw new UserInputError('交付邮箱不存在');
        await repository
            .createQueryBuilder()
            .update(CustomerDeliveryEmail)
            .set({ isDefault: false })
            .where('channelId = :channelId AND customerId = :customerId', {
                channelId: ctx.channelId,
                customerId: customer.id,
            })
            .execute();
        entity.isDefault = true;
        return repository.save(entity);
    }

    async deleteMine(ctx: RequestContext, id: ID): Promise<boolean> {
        const customer = await this.activeCustomer(ctx);
        const repository = this.connection.getRepository(ctx, CustomerDeliveryEmail);
        const entity = await repository.findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id },
        });
        if (!entity) throw new UserInputError('交付邮箱不存在');
        const wasDefault = entity.isDefault;
        await repository.remove(entity);
        if (wasDefault) {
            const [next] = await repository.find({
                where: { channelId: ctx.channelId, customerId: customer.id },
                order: { createdAt: 'ASC' },
                take: 1,
            });
            if (next) {
                next.isDefault = true;
                await repository.save(next);
            }
        }
        return true;
    }

    async ownedEmail(ctx: RequestContext, id: ID): Promise<CustomerDeliveryEmail> {
        const customer = await this.activeCustomer(ctx);
        const email = await this.connection.getRepository(ctx, CustomerDeliveryEmail).findOne({
            where: { id, channelId: ctx.channelId, customerId: customer.id },
        });
        if (!email) throw new UserInputError('交付邮箱不存在');
        return email;
    }

    async setActiveOrderEmail(ctx: RequestContext, input: SetActiveOrderDeliveryEmailInput): Promise<Order> {
        const order = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!order) {
            throw new UserInputError('当前没有可结账的订单');
        }
        let contact: CustomerDeliveryEmail | undefined;
        let emailAddress: string;
        if (input.contactId) {
            contact = await this.ownedEmail(ctx, input.contactId);
            emailAddress = contact.emailAddress;
        } else {
            emailAddress = normalizeEmail(input.emailAddress ?? '');
            if (emailAddress !== normalizeEmail(input.confirmEmailAddress ?? '')) {
                throw new UserInputError('两次输入的交付邮箱不一致');
            }
            if (input.saveToAddressBook && ctx.activeUserId) {
                contact = await this.saveMine(ctx, {
                    emailAddress,
                    confirmEmailAddress: emailAddress,
                    label: input.label,
                    isDefault: input.isDefault,
                });
            }
        }
        return this.orderService.updateCustomFields(ctx, order.id, {
            ...order.customFields,
            deliveryEmail: emailAddress,
            deliveryEmailContactId: contact ? String(contact.id) : null,
        });
    }

    private async activeCustomer(ctx: RequestContext): Promise<Customer> {
        const customer = ctx.activeUserId
            ? await this.customerService.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        if (!customer) {
            throw new UserInputError('请登录后管理交付邮箱');
        }
        return customer;
    }
}

function normalizeEmail(value: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
        throw new UserInputError('请输入有效的交付邮箱');
    }
    return normalized;
}

function normalizeLabel(value: string | null | undefined): string {
    const label = value?.trim() ?? '';
    if (label.length > 80) throw new UserInputError('邮箱备注不能超过 80 个字符');
    return label;
}
