import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { USDT_TRC20_CONTRACT_ADDRESS, USDT_TRC20_NETWORK } from './usdt-payment.constants';

const TRON_MAINNET_ADDRESS_PREFIX = 0x41;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface UsdtWalletConfiguration {
    enabled: boolean;
    network: typeof USDT_TRC20_NETWORK;
    tokenContractAddress: typeof USDT_TRC20_CONTRACT_ADDRESS;
    receivingAddress: string | null;
    receivingAddressFingerprint: string | null;
}

export interface ConfiguredUsdtWalletConfiguration extends UsdtWalletConfiguration {
    enabled: true;
    receivingAddress: string;
    receivingAddressFingerprint: string;
}

@Injectable()
export class UsdtWalletConfigurationService {
    private readonly configuration: UsdtWalletConfiguration;

    constructor() {
        this.configuration = loadUsdtWalletConfiguration(process.env, process.env.NODE_ENV === 'production');
    }

    get(): UsdtWalletConfiguration {
        return { ...this.configuration };
    }

    requireConfigured(): ConfiguredUsdtWalletConfiguration {
        const configuration = this.get();
        if (
            !configuration.enabled ||
            !configuration.receivingAddress ||
            !configuration.receivingAddressFingerprint
        ) {
            throw new Error('USDT-TRC20 收款尚未配置，请联系商家');
        }
        return configuration as ConfiguredUsdtWalletConfiguration;
    }

    tronGridHeaders(): Record<string, string> {
        const apiKey = process.env.TRONGRID_API_KEY?.trim();
        return apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};
    }
}

export function loadUsdtWalletConfiguration(
    environment: NodeJS.ProcessEnv,
    production: boolean,
): UsdtWalletConfiguration {
    const receivingAddress = environment.STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS?.trim() || null;
    if (!receivingAddress) {
        return {
            enabled: false,
            network: USDT_TRC20_NETWORK,
            tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
            receivingAddress: null,
            receivingAddressFingerprint: null,
        };
    }
    if (!isValidTronMainnetAddress(receivingAddress)) {
        throw new Error('STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS is not a valid TRON mainnet address');
    }

    const fingerprint = fingerprintReceivingAddress(receivingAddress);
    const configuredFingerprint = environment.STOREFRONT_USDT_TRC20_ADDRESS_SHA256?.trim().toLowerCase();
    if (
        configuredFingerprint &&
        (!SHA256_PATTERN.test(configuredFingerprint) || configuredFingerprint !== fingerprint)
    ) {
        throw new Error(
            'STOREFRONT_USDT_TRC20_ADDRESS_SHA256 does not match the configured receiving address',
        );
    }
    if (production && !configuredFingerprint) {
        throw new Error(
            'STOREFRONT_USDT_TRC20_ADDRESS_SHA256 is required when USDT receiving is enabled in production',
        );
    }

    return {
        enabled: true,
        network: USDT_TRC20_NETWORK,
        tokenContractAddress: USDT_TRC20_CONTRACT_ADDRESS,
        receivingAddress,
        receivingAddressFingerprint: fingerprint,
    };
}

export function fingerprintReceivingAddress(address: string): string {
    return createHash('sha256').update(`storefront-usdt-wallet:v1:${address}`, 'utf8').digest('hex');
}

export function isValidTronMainnetAddress(address: string): boolean {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(address)) return false;
    const decoded = decodeBase58(address);
    if (!decoded || decoded.length !== 25 || decoded[0] !== TRON_MAINNET_ADDRESS_PREFIX) return false;
    const body = decoded.subarray(0, 21);
    const checksum = decoded.subarray(21);
    const expected = doubleSha256(body).subarray(0, 4);
    return checksum.equals(expected);
}

function decodeBase58(value: string): Buffer | null {
    let decoded = BigInt(0);
    for (const character of value) {
        const digit = BASE58_ALPHABET.indexOf(character);
        if (digit < 0) return null;
        decoded = decoded * BigInt(58) + BigInt(digit);
    }
    let hex = decoded.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    const payload = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
    let leadingZeroCount = 0;
    while (leadingZeroCount < value.length && value[leadingZeroCount] === '1') leadingZeroCount += 1;
    return Buffer.concat([Buffer.alloc(leadingZeroCount), payload]);
}

function doubleSha256(value: Buffer): Buffer {
    return createHash('sha256').update(createHash('sha256').update(value).digest()).digest();
}
