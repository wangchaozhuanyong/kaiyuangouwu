import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity('shop_abuse_bucket')
@Index('UQ_shop_abuse_bucket_bucket', ['bucket'], { unique: true })
@Index('IDX_shop_abuse_bucket_expires', ['expiresAt'])
export class ShopAbuseBucket extends VendureEntity {
    constructor(input?: DeepPartial<ShopAbuseBucket>) {
        super(input);
    }
    @Column({ type: 'varchar', length: 64 }) bucket: string;
    @Column({ type: 'int', default: 0 }) attempts: number;
    @Column({ type: Date }) expiresAt: Date;
    @Column({ type: Date, nullable: true }) blockedUntil: Date | null;
}

@Entity('shop_abuse_challenge')
@Index('UQ_shop_abuse_challenge_public', ['publicId'], { unique: true })
@Index('IDX_shop_abuse_challenge_expires', ['expiresAt'])
export class ShopAbuseChallenge extends VendureEntity {
    constructor(input?: DeepPartial<ShopAbuseChallenge>) {
        super(input);
    }
    @Column({ type: 'varchar', length: 64 }) publicId: string;
    @Column({ type: 'varchar', length: 64 }) bindingHash: string;
    @Column({ type: 'varchar', length: 64 }) answerDigest: string;
    @Column({ type: Date }) expiresAt: Date;
    @Column({ type: Date, nullable: true }) consumedAt: Date | null;
}
