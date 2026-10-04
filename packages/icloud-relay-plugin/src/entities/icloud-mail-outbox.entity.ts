import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/** Durable metadata only. No address, body, query code or OTP is placed on the wire. */
@Entity({ name: 'icloud_mail_outbox' })
@Index('IDX_icloud_outbox_pending', ['deliveredAt', 'id'])
export class IcloudMailOutbox extends VendureEntity {
    constructor(input?: DeepPartial<IcloudMailOutbox>) {
        super(input);
    }
    @Column({ type: 'varchar', length: 36, unique: true }) eventId: string;
    @Column({ type: 'varchar', length: 64 }) primaryAccountId: string;
    @Column({ type: 'varchar', length: 64, nullable: true }) virtualEmailId: string | null;
    @Column({ type: Date, nullable: true }) deliveredAt: Date | null;
}
