import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'image_provider_billing_link' })
@Index('IDX_image_billing_link_bill', ['billKey'], { unique: true })
@Index('IDX_image_billing_link_target', ['targetKey'])
export class ImageProviderBillingLink extends VendureEntity {
    constructor(input?: DeepPartial<ImageProviderBillingLink>) {
        super(input);
    }
    @Column({ type: 'varchar', length: 64 })
    billKey: string;
    @Column({ type: 'varchar', length: 64 })
    targetKey: string;
    @Column({ type: 'varchar', length: 128 })
    supplierScope: string;
    @Column({ type: 'varchar', length: 200 })
    billId: string;
    @Column({ type: 'varchar', length: 64 })
    adjustmentIdSnapshot: string;
}
