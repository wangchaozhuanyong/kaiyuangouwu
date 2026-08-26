import { Injectable } from '@nestjs/common';

import { USDT_TRC20_CONTRACT_ADDRESS, USDT_TRC20_DECIMALS } from './usdt-payment.constants';
import { UsdtWalletConfigurationService } from './usdt-wallet-configuration.service';

const TRONGRID_BASE_URL = 'https://api.trongrid.io';
const MAX_TRANSFER_PAGES = 5;

interface TronGridTransferResponse {
    data?: TronGridTransferRecord[];
    meta?: { fingerprint?: string };
    success?: boolean;
}

interface TronGridTransferRecord {
    transaction_id?: string;
    token_info?: {
        address?: string;
        decimals?: number;
        symbol?: string;
    };
    block_timestamp?: number;
    from?: string;
    to?: string;
    type?: string;
    value?: string;
}

interface TronTransactionReceipt {
    id?: string;
    blockNumber?: number;
    receipt?: { result?: string };
}

export interface ConfirmedTrc20Transfer {
    transactionId: string;
    from: string;
    to: string;
    amount: string;
    blockTimestamp: Date;
}

export interface SolidifiedTronTransaction {
    transactionId: string;
    blockNumber: number;
}

@Injectable()
export class UsdtTrc20Client {
    constructor(private readonly walletConfiguration: UsdtWalletConfigurationService) {}

    async incomingTransfers(minTimestamp: Date): Promise<ConfirmedTrc20Transfer[]> {
        const wallet = this.walletConfiguration.requireConfigured();
        const records: ConfirmedTrc20Transfer[] = [];
        let fingerprint: string | undefined;

        for (let page = 0; page < MAX_TRANSFER_PAGES; page += 1) {
            const url = new URL(
                `/v1/accounts/${encodeURIComponent(wallet.receivingAddress)}/transactions/trc20`,
                TRONGRID_BASE_URL,
            );
            url.searchParams.set('only_confirmed', 'true');
            url.searchParams.set('only_to', 'true');
            url.searchParams.set('limit', '200');
            url.searchParams.set('order_by', 'block_timestamp,desc');
            url.searchParams.set('min_timestamp', String(minTimestamp.getTime()));
            url.searchParams.set('contract_address', USDT_TRC20_CONTRACT_ADDRESS);
            if (fingerprint) url.searchParams.set('fingerprint', fingerprint);

            const response = await fetch(url, {
                headers: { accept: 'application/json', ...this.walletConfiguration.tronGridHeaders() },
                signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok) throw new Error(`TronGrid transfer query failed (${response.status})`);
            const payload = (await response.json()) as TronGridTransferResponse;
            if (payload.success === false) throw new Error('TronGrid rejected the transfer query');
            for (const record of payload.data ?? []) {
                const transfer = parseConfirmedUsdtTransfer(record, wallet.receivingAddress);
                if (transfer) records.push(transfer);
            }
            fingerprint = payload.meta?.fingerprint;
            if (!fingerprint || !(payload.data ?? []).length) break;
        }

        return deduplicateTransfers(records);
    }

    async solidifiedTransaction(transactionId: string): Promise<SolidifiedTronTransaction | null> {
        const response = await fetch(`${TRONGRID_BASE_URL}/walletsolidity/gettransactioninfobyid`, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                ...this.walletConfiguration.tronGridHeaders(),
            },
            body: JSON.stringify({ value: transactionId }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`TronGrid solidified receipt query failed (${response.status})`);
        const receipt = (await response.json()) as TronTransactionReceipt;
        if (
            receipt.id?.toLowerCase() !== transactionId.toLowerCase() ||
            !Number.isInteger(receipt.blockNumber) ||
            Number(receipt.blockNumber) <= 0 ||
            receipt.receipt?.result !== 'SUCCESS'
        ) {
            return null;
        }
        return { transactionId, blockNumber: Number(receipt.blockNumber) };
    }
}

export function parseConfirmedUsdtTransfer(
    record: TronGridTransferRecord,
    receivingAddress: string,
): ConfirmedTrc20Transfer | null {
    const transactionId = record.transaction_id?.trim() ?? '';
    const value = record.value?.trim() ?? '';
    const blockTimestamp = Number(record.block_timestamp);
    if (
        !/^[a-fA-F0-9]{64}$/u.test(transactionId) ||
        record.to !== receivingAddress ||
        !record.from ||
        record.type !== 'Transfer' ||
        record.token_info?.address !== USDT_TRC20_CONTRACT_ADDRESS ||
        record.token_info?.symbol !== 'USDT' ||
        Number(record.token_info?.decimals) !== USDT_TRC20_DECIMALS ||
        !/^\d+$/u.test(value) ||
        !Number.isFinite(blockTimestamp) ||
        blockTimestamp <= 0
    ) {
        return null;
    }
    return {
        transactionId: transactionId.toLowerCase(),
        from: record.from,
        to: record.to,
        amount: formatUsdtBaseUnits(value),
        blockTimestamp: new Date(blockTimestamp),
    };
}

export function formatUsdtBaseUnits(value: string): string {
    const baseUnits = BigInt(value);
    const whole = baseUnits / BigInt(1_000_000);
    const fractional = (baseUnits % BigInt(1_000_000)).toString().padStart(6, '0');
    return `${whole}.${fractional}`;
}

function deduplicateTransfers(transfers: ConfirmedTrc20Transfer[]): ConfirmedTrc20Transfer[] {
    return Array.from(new Map(transfers.map(transfer => [transfer.transactionId, transfer])).values());
}
