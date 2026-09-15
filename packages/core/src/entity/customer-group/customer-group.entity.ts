import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinColumn, ManyToMany, ManyToOne, OneToMany } from 'typeorm';

import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { CustomCustomerGroupFields } from '../custom-entity-fields';
import { Customer } from '../customer/customer.entity';
import { EntityId } from '../entity-id.decorator';
import { TaxRate } from '../tax-rate/tax-rate.entity';

/**
 * @description
 * A grouping of {@link Customer}s which enables features such as group-based promotions
 * or tax rules.
 *
 * @docsCategory entities
 */
@Entity()
export class CustomerGroup extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<CustomerGroup>) {
        super(input);
    }

    @Column() name: string;

    @Index('IDX_customer_group_channel')
    @ManyToOne(type => Channel, { nullable: true, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_customer_group_channel' })
    channel?: Channel;

    /** Null legacy groups do not grant eligibility until their owner is reviewed. */
    @EntityId({ nullable: true })
    channelId: ID | null;

    @ManyToMany(type => Customer, customer => customer.groups)
    customers: Customer[];

    @Column(type => CustomCustomerGroupFields)
    customFields: CustomCustomerGroupFields;

    @OneToMany(type => TaxRate, taxRate => taxRate.zone)
    taxRates: TaxRate[];
}
