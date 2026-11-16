import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity('tax_free_address_pool')
export class TaxFreeAddressPool extends VendureEntity {
    constructor(input?: DeepPartial<TaxFreeAddressPool>) {
        super(input);
    }
    @Column({ type: 'int', default: 0 }) cursor: number;
    @Column({ type: 'int', default: 0 }) revision: number;
}

@Entity('tax_free_address_fingerprint')
@Index('UQ_tax_address_fingerprint', ['fingerprint'], { unique: true })
@Index('UQ_tax_address_request', ['requestKey'], { unique: true })
@Index('IDX_tax_address_browser_claim', ['browserHash', 'claimedAt'])
export class TaxFreeAddressFingerprint extends VendureEntity {
    constructor(input?: DeepPartial<TaxFreeAddressFingerprint>) {
        super(input);
    }
    @Column({ type: 'varchar', length: 64 }) fingerprint: string;
    // Permanent, minimal receipts survive pruning. No address text or raw browser identifier.
    @Column({ type: 'varchar', length: 64, nullable: true }) requestKey: string | null;
    @Column({ type: 'varchar', length: 64, nullable: true }) browserHash: string | null;
    @Column({ type: 'varchar', length: 64, nullable: true }) channelId: string | null;
    @Column({ type: Date, precision: 3, nullable: true }) claimedAt: Date | null;
}

@Entity('tax_free_address')
@Index('UQ_tax_address_live_fingerprint', ['fingerprint'], { unique: true })
@Index('IDX_tax_address_status_used', ['status', 'usedAt'])
export class TaxFreeAddressEntity extends VendureEntity {
    constructor(input?: DeepPartial<TaxFreeAddressEntity>) {
        super(input);
    }
    @Column({ type: 'varchar', length: 64 }) fingerprint: string;
    @Column({ type: 'varchar', length: 32 }) country: string;
    @Column({ type: 'varchar', length: 120 }) line1: string;
    @Column({ type: 'varchar', length: 80 }) city: string;
    @Column({ type: 'varchar', length: 80 }) state: string;
    @Column({ type: 'varchar', length: 5 }) postalCode: string;
    @Column({ type: 'varchar', length: 8, default: 'unused' }) status: 'unused' | 'used';
    @Column({ type: Date, precision: 3, nullable: true }) usedAt: Date | null;
}
