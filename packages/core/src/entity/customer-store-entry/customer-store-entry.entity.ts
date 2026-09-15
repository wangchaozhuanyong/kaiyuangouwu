import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { Customer } from '../customer/customer.entity';
import { EntityId } from '../entity-id.decorator';

/** Business entry history; Customer.channels remains the membership/access relation. */
@Entity()
@Index('UQ_customer_store_entry', ['customerId', 'channelId'], { unique: true })
export class CustomerStoreEntry extends VendureEntity {
    constructor(input?: DeepPartial<CustomerStoreEntry>) {
        super(input);
    }

    @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_customer_store_entry_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @ManyToOne(() => Channel, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_customer_store_entry_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    /** Null for unverified registration or legacy membership whose first visit is unknown. */
    @Column({ type: Date, nullable: true })
    firstSeenAt: Date | null;

    @Column({ type: 'varchar', length: 32 })
    source: 'REGISTRATION' | 'AUTHENTICATED_ENTRY' | 'LEGACY_UNRESOLVED';
}
