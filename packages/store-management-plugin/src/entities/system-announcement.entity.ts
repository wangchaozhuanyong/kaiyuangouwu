import { Channel, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import type { SystemAnnouncementTargetMode } from '../types';

@Entity({ name: 'system_announcement' })
@Index('IDX_system_announcement_schedule', ['enabled', 'startsAt', 'endsAt', 'priority'])
@Index('IDX_system_announcement_owner', ['ownerChannelId'])
export class SystemAnnouncement extends VendureEntity {
    constructor(input?: DeepPartial<SystemAnnouncement>) {
        super(input);
    }

    @Column('boolean', { default: true })
    enabled: boolean;

    @Column('integer', { default: 0 })
    priority: number;

    @Column('varchar', { length: 16, default: 'ALL' })
    targetMode: SystemAnnouncementTargetMode;

    /** Null identifies platform publication, including every pre-ownership announcement. */
    @ManyToOne(() => Channel, { nullable: true, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'ownerChannelId', foreignKeyConstraintName: 'FK_system_announcement_owner' })
    ownerChannel: Channel | null;

    @EntityId({ nullable: true })
    ownerChannelId: ID | null;

    @ManyToMany(() => Channel, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
    @JoinTable({
        name: 'system_announcement_channels_channel',
        joinColumn: {
            name: 'systemAnnouncementId',
            referencedColumnName: 'id',
            foreignKeyConstraintName: 'FK_system_announcement_channels_announcement',
        },
        inverseJoinColumn: {
            name: 'channelId',
            referencedColumnName: 'id',
            foreignKeyConstraintName: 'FK_system_announcement_channels_channel',
        },
    })
    channels: Channel[];

    @Column('varchar', { length: 120 })
    titleZh: string;

    @Column('varchar', { length: 120, default: '' })
    titleEn: string;

    @Column('text')
    contentZh: string;

    @Column('text')
    contentEn: string;

    @Column('varchar', { length: 500, nullable: true })
    linkUrl: string | null;

    @Column({ type: Date, nullable: true })
    startsAt: Date | null;

    @Column({ type: Date, nullable: true })
    endsAt: Date | null;
}
