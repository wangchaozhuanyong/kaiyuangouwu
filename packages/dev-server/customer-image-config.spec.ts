import { describe, expect, it } from 'vitest';

import { customerImageConfiguration } from './customer-image-config';

const environment = {
    CUSTOMER_IMAGE_PROCESSOR_SOCKET: '/run/image/worker.sock',
    CUSTOMER_AVATAR_STORAGE_ROOT: '/data/avatars',
    IMAGE_GENERATION_STORAGE_ROOT: '/data/private',
};

describe('customer image production configuration', () => {
    it('requires the processor and rejects overlapping storage roots', () => {
        expect(() => customerImageConfiguration('/data/assets', true, {})).toThrow('PROCESSOR_SOCKET');
        expect(() =>
            customerImageConfiguration('/data/assets', true, {
                ...environment,
                CUSTOMER_AVATAR_STORAGE_ROOT: '/data/assets/avatars',
            }),
        ).toThrow('separate');
        expect(() => customerImageConfiguration('/data/assets', true, environment)).not.toThrow();
    });
    it('requires distinct buckets and an HTTPS media origin before enabling S3', () => {
        const s3 = {
            ...environment,
            CUSTOMER_IMAGE_STORAGE: 's3',
            AWS_REGION: 'us-east-1',
            CUSTOMER_AVATAR_S3_BUCKET: 'synthetic-avatar-bucket',
            CUSTOMER_PRIVATE_IMAGE_S3_BUCKET: 'synthetic-private-bucket',
            CUSTOMER_AVATAR_CDN_ORIGIN: 'https://media.example.test',
        };
        expect(() => customerImageConfiguration('/data/assets', true, s3)).not.toThrow();
        expect(() =>
            customerImageConfiguration('/data/assets', true, {
                ...s3,
                CUSTOMER_PRIVATE_IMAGE_S3_BUCKET: s3.CUSTOMER_AVATAR_S3_BUCKET,
            }),
        ).toThrow('distinct');
        expect(() =>
            customerImageConfiguration('/data/assets', true, {
                ...s3,
                CUSTOMER_AVATAR_CDN_ORIGIN: 'http://media.example.test',
            }),
        ).toThrow('HTTPS');
        expect(() =>
            customerImageConfiguration('/data/assets', true, {
                ...s3,
                CUSTOMER_AVATAR_CDN_ORIGIN: 'https://media.example.test/unsafe/path',
            }),
        ).toThrow('HTTPS');
    });
});
