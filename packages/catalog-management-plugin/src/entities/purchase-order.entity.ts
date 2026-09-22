import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, StockLocation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, VersionColumn } from 'typeorm';

import { CatalogSupplier } from './catalog-supplier.entity';
import { PurchaseOrderEvent } from './purchase-order-event.entity';
import { PurchaseOrderLine } from './purchase-order-line.entity';
import { PurchaseReceipt } from './purchase-receipt.entity';
import { PurchaseSupplierReturn } from './purchase-supplier-return.entity';

export type PurchaseOrderStatus =
    'DRAFT' | 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'VARIANCE_REVIEW' | 'CLOSED' | 'CANCELLED';

export type PurchasePaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'DISPUTED';

@Entity({ name: 'catalog_purchase_order' })
@Index('IDX_catalog_purchase_order_channel_code', ['channelId', 'code'], { unique: true })
@Index('IDX_catalog_purchase_order_channel_status', ['channelId', 'status', 'expectedAt'])
@Index('IDX_catalog_purchase_order_supplier_created', ['supplierId', 'createdAt'])
export class PurchaseOrder extends VendureEntity {
    constructor(input?: DeepPartial<PurchaseOrder>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_catalog_purchase_order_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => CatalogSupplier, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'supplierId', foreignKeyConstraintName: 'FK_catalog_purchase_order_supplier' })
    supplier: CatalogSupplier;

    @EntityId()
    supplierId: ID;

    @ManyToOne(() => StockLocation, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'stockLocationId', foreignKeyConstraintName: 'FK_catalog_purchase_order_location' })
    stockLocation: StockLocation;

    @EntityId()
    stockLocationId: ID;

    @Column({ type: 'varchar', length: 64 })
    code: string;

    @Column({ type: 'varchar', length: 24, default: 'DRAFT' })
    status: PurchaseOrderStatus;

    @Column({ type: 'varchar', length: 24, default: 'UNPAID' })
    paymentStatus: PurchasePaymentStatus;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column({ type: 'bigint', default: 0 })
    totalMicrounits: string;

    @Column({ type: 'bigint', default: 0 })
    paidMicrounits: string;

    @Column({ type: 'bigint', default: 0 })
    returnCreditMicrounits: string;

    @Column({ type: Date, nullable: true })
    expectedAt: Date | null;

    @Column({ type: Date, nullable: true })
    submittedAt: Date | null;

    @Column({ type: Date, nullable: true })
    closedAt: Date | null;

    @Column({ type: 'varchar', length: 128, nullable: true })
    createdByUserId: string | null;

    @Column({ type: 'varchar', length: 128, nullable: true })
    submittedByUserId: string | null;

    @Column({ type: 'varchar', length: 128, nullable: true })
    closedByUserId: string | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @Column({ type: 'text', nullable: true })
    closureNote: string | null;

    @OneToMany(() => PurchaseOrderLine, line => line.purchaseOrder)
    lines: PurchaseOrderLine[];

    @OneToMany(() => PurchaseReceipt, receipt => receipt.purchaseOrder)
    receipts: PurchaseReceipt[];

    @OneToMany(() => PurchaseSupplierReturn, supplierReturn => supplierReturn.purchaseOrder)
    supplierReturns: PurchaseSupplierReturn[];

    @OneToMany(() => PurchaseOrderEvent, event => event.purchaseOrder)
    events: PurchaseOrderEvent[];

    @VersionColumn()
    version: number;
}
