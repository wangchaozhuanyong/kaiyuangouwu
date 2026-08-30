import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import { usdtTrc20PaymentHandler } from './usdt-payment-handler';
import {
    configureUsdtPaymentProofSecret,
    createUsdtPaymentProof,
    verifyUsdtPaymentProof,
} from './usdt-payment-proof';
import { USDT_TRC20_CONTRACT_ADDRESS } from './usdt-payment.constants';
import { createMatchKey, findMatchingTransfer } from './usdt-payment.service';
import { formatUsdtBaseUnits, parseConfirmedUsdtTransfer } from './usdt-trc20-client';
import {
    fingerprintReceivingAddress,
    isValidTronMainnetAddress,
    loadUsdtWalletConfiguration,
    UsdtWalletConfigurationService,
} from './usdt-wallet-configuration.service';

const address = USDT_TRC20_CONTRACT_ADDRESS;

describe('USDT payment security', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('validates the TRON Base58Check checksum instead of trusting the T prefix', () => {
        expect(isValidTronMainnetAddress(address)).toBe(true);
        expect(isValidTronMainnetAddress(`${address.slice(0, -1)}2`)).toBe(false);
    });

    it('refuses production receiving when the independently configured fingerprint is missing', () => {
        expect(() =>
            loadUsdtWalletConfiguration({ STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS: address }, true),
        ).toThrow('ADDRESS_SHA256 is required');
    });

    it('refuses a changed wallet address when its pinned fingerprint does not match', () => {
        expect(() =>
            loadUsdtWalletConfiguration(
                {
                    STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS: address,
                    STOREFRONT_USDT_TRC20_ADDRESS_SHA256: '0'.repeat(64),
                },
                true,
            ),
        ).toThrow('does not match');
    });

    it('accepts a production wallet only when the full address and fingerprint match', () => {
        const configuration = loadUsdtWalletConfiguration(
            {
                STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS: address,
                STOREFRONT_USDT_TRC20_ADDRESS_SHA256: fingerprintReceivingAddress(address),
            },
            true,
        );

        expect(configuration).toMatchObject({
            enabled: true,
            network: 'TRC20',
            receivingAddress: address,
            receivingAddressFingerprint: fingerprintReceivingAddress(address),
        });
    });

    it('encrypts Channel wallet addresses with authenticated encryption before persistence', () => {
        vi.stubEnv('USDT_WALLET_ENCRYPTION_KEY', 'unit-test-wallet-encryption-key-that-is-long-enough');
        const configuration = new UsdtWalletConfigurationService();

        const encrypted = configuration.encryptReceivingAddress(address);
        const tamperedParts = encrypted.split(':');
        tamperedParts[2] = `${tamperedParts[2][0] === 'A' ? 'B' : 'A'}${tamperedParts[2].slice(1)}`;

        expect(encrypted).not.toContain(address);
        expect(configuration.decryptReceivingAddress(encrypted)).toBe(address);
        expect(() => configuration.decryptReceivingAddress(tamperedParts.join(':'))).toThrow();
    });

    it('signs server-only settlement proofs and rejects tampering', () => {
        configureUsdtPaymentProofSecret('unit-test-usdt-proof-secret-that-is-long-enough');
        const proof = createUsdtPaymentProof({
            channelId: '1',
            quoteId: '2',
            orderId: '3',
            fiatCurrencyCode: 'CNY',
            fiatAmount: 10_000,
            transactionId: 'a'.repeat(64),
            usdtAmount: '13.850123',
            receivingAddressFingerprint: fingerprintReceivingAddress(address),
            expiresAt: Date.now() + 60_000,
        });

        expect(verifyUsdtPaymentProof(proof)).toMatchObject({ orderId: '3', fiatAmount: 10_000 });
        expect(verifyUsdtPaymentProof(`${proof.slice(0, -1)}x`)).toBeNull();
    });

    it('does not let a storefront caller create a settled payment without the server proof', async () => {
        configureUsdtPaymentProofSecret('unit-test-usdt-proof-secret-that-is-long-enough');
        const declined = await usdtTrc20PaymentHandler.createPayment(
            { channelId: '1' } as any,
            { id: '3', currencyCode: 'CNY' } as any,
            10_000,
            [],
            { proof: 'customer-forged-proof' },
            {} as any,
        );
        expect(declined.state).toBe('Declined');

        const proof = createUsdtPaymentProof({
            channelId: '1',
            quoteId: '2',
            orderId: '3',
            fiatCurrencyCode: 'CNY',
            fiatAmount: 10_000,
            transactionId: 'd'.repeat(64),
            usdtAmount: '13.850123',
            receivingAddressFingerprint: fingerprintReceivingAddress(address),
            expiresAt: Date.now() + 60_000,
        });
        const settled = await usdtTrc20PaymentHandler.createPayment(
            { channelId: '1' } as any,
            { id: '3', currencyCode: 'CNY' } as any,
            10_000,
            [],
            { proof },
            {} as any,
        );
        expect(settled).toMatchObject({
            amount: 10_000,
            state: 'Settled',
            transactionId: `tron:${'d'.repeat(64)}`,
        });
    });

    it('only parses confirmed transfer records for the official TRC20 USDT contract and exact recipient', () => {
        const record = {
            transaction_id: 'b'.repeat(64),
            token_info: { address: USDT_TRC20_CONTRACT_ADDRESS, decimals: 6, symbol: 'USDT' },
            block_timestamp: Date.now(),
            from: 'TSender111111111111111111111111111',
            to: address,
            type: 'Transfer',
            value: '13850123',
        };

        expect(parseConfirmedUsdtTransfer(record, address)?.amount).toBe('13.850123');
        expect(parseConfirmedUsdtTransfer({ ...record, to: 'TWrong' }, address)).toBeNull();
        expect(
            parseConfirmedUsdtTransfer(
                { ...record, token_info: { ...record.token_info, address: 'TFake' } },
                address,
            ),
        ).toBeNull();
        expect(formatUsdtBaseUnits('1')).toBe('0.000001');
    });

    it('matches only the exact unique amount inside the locked payment window', () => {
        const createdAt = new Date('2026-08-26T02:00:00.000Z');
        const expiresAt = new Date('2026-08-26T02:10:00.000Z');
        const intent = {
            expectedUsdtAmount: '13.850123',
            receivingAddress: address,
            createdAt,
            expiresAt,
        } as StorefrontUsdtPaymentIntent;
        const transfer = {
            transactionId: 'c'.repeat(64),
            from: 'TSender',
            to: address,
            amount: '13.850123',
            blockTimestamp: new Date('2026-08-26T02:05:00.000Z'),
        };

        expect(findMatchingTransfer(intent, [transfer])).toEqual(transfer);
        expect(findMatchingTransfer(intent, [{ ...transfer, amount: '13.850124' }])).toBeUndefined();
        expect(
            findMatchingTransfer(intent, [
                { ...transfer, blockTimestamp: new Date('2026-08-26T02:20:00.000Z') },
            ]),
        ).toBeUndefined();
        expect(createMatchKey('TRC20', 'a'.repeat(64), '13.850123')).not.toBe(
            createMatchKey('TRC20', 'a'.repeat(64), '13.850124'),
        );
    });
});
