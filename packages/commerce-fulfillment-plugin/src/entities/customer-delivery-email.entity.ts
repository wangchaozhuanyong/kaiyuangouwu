import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'customer_delivery_email' })
@Index('IDX_customer_delivery_email_unique', ['channelId', 'customerId', 'normalizedEmail'], {
    unique: true,
})
@Index('IDX_customer_delivery_email_default', ['channelId', 'customerId', 'isDefault'])
export class CustomerDeliveryEmail extends VendureEntity {
    constructor(input?: DeepPartial<CustomerDeliveryEmail>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 254 })
    emailAddress: string;

    @Column({ type: 'varchar', length: 254 })
    normalizedEmail: string;

    @Column({ type: 'varchar', length: 80, default: '' })
    label: string;

    @Column({ type: 'boolean', default: false })
    isDefault: boolean;

    @Column({ type: Date })
    confirmedAt: Date;

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_delivery_email_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_delivery_email_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;
}
