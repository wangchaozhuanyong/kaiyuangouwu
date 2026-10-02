import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index } from 'typeorm';

import { VendureEntity } from '../base/base.entity';
import { EntityId } from '../entity-id.decorator';

/** A store switch never changes the platform handler, credentials, or global kill switch. */
@Entity()
@Index('IDX_store_payment_method_state', ['channelId', 'paymentMethodId'], { unique: true })
export class StorePaymentMethodState extends VendureEntity {
    constructor(input?: DeepPartial<StorePaymentMethodState>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @EntityId() paymentMethodId: ID;
    @Column({ default: false }) enabled: boolean;
}
