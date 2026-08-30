import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { StoreUsdtManualRefund } from './store-usdt-manual-refund.entity';
import { StoreUsdtWalletAudit } from './store-usdt-wallet-audit.entity';
import { StoreUsdtWallet } from './store-usdt-wallet.entity';
import { SystemAnnouncement } from './system-announcement.entity';

type ForeignKeyTarget = typeof StoreUsdtWallet | typeof StoreUsdtWalletAudit | typeof StoreUsdtManualRefund;
type IndexedTarget = typeof StoreUsdtWallet | typeof StoreUsdtManualRefund;

describe('Channel announcement and USDT entity schema', () => {
    it('uses the stable foreign-key names created by production migrations', () => {
        expect(foreignKeyNames(StoreUsdtWallet)).toEqual({
            channel: 'FK_store_usdt_wallet_channel',
        });
        expect(foreignKeyNames(StoreUsdtWalletAudit)).toEqual({
            channel: 'FK_store_usdt_wallet_audit_channel',
        });
        expect(foreignKeyNames(StoreUsdtManualRefund)).toEqual({
            channel: 'FK_store_usdt_manual_refund_channel',
            payment: 'FK_store_usdt_manual_refund_payment',
            order: 'FK_store_usdt_manual_refund_order',
            refund: 'FK_store_usdt_manual_refund_refund',
        });

        const joinTable = getMetadataArgsStorage().joinTables.find(
            table => table.target === SystemAnnouncement && table.propertyName === 'channels',
        );
        expect(joinTable?.joinColumns?.[0]?.foreignKeyConstraintName).toBe(
            'FK_system_announcement_channels_announcement',
        );
        expect(joinTable?.inverseJoinColumns?.[0]?.foreignKeyConstraintName).toBe(
            'FK_system_announcement_channels_channel',
        );
    });

    it('declares the operational indexes created by production migrations', () => {
        expect(indexNames(StoreUsdtWallet)).toEqual(
            expect.arrayContaining(['IDX_store_usdt_wallet_channel', 'IDX_store_usdt_wallet_review_status']),
        );
        expect(indexNames(StoreUsdtManualRefund)).toEqual(
            expect.arrayContaining([
                'IDX_store_usdt_manual_refund_transaction',
                'IDX_store_usdt_manual_refund_refund',
                'IDX_store_usdt_manual_refund_channel_created',
                'IDX_store_usdt_manual_refund_payment',
            ]),
        );
    });
});

function foreignKeyNames(target: ForeignKeyTarget): Record<string, string | undefined> {
    return Object.fromEntries(
        getMetadataArgsStorage()
            .joinColumns.filter(column => column.target === target)
            .map(column => [column.propertyName, column.foreignKeyConstraintName]),
    );
}

function indexNames(target: IndexedTarget): string[] {
    return getMetadataArgsStorage()
        .indices.filter(index => index.target === target)
        .map(index => String(index.name));
}
