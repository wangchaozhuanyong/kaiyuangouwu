import { Injectable } from '@nestjs/common';
import { LogicalOperator, SortOrder } from '@vendure/common/lib/generated-types';
import {
    Asset,
    AssetService,
    Customer,
    CustomerService,
    isGraphQlErrorResult,
    RequestContext,
    UserInputError,
} from '@vendure/core';
import { Readable } from 'node:stream';

export const CUSTOMER_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const CUSTOMER_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const CUSTOMER_AVATAR_TAG = 'customer-avatar';
const CUSTOMER_AVATAR_OWNER_TAG_PREFIX = 'customer-avatar-owner:';
const AVATAR_EXTENSION_BY_MIME_TYPE: Record<(typeof CUSTOMER_AVATAR_MIME_TYPES)[number], string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

export interface CustomerAvatarUpload {
    filename: string;
    mimetype: string;
    encoding?: string;
    createReadStream(): NodeJS.ReadableStream;
}

@Injectable()
export class CustomerAvatarService {
    constructor(
        private readonly assetService: AssetService,
        private readonly customerService: CustomerService,
    ) {}

    async findMine(ctx: RequestContext): Promise<Asset | null> {
        if (!ctx.activeUserId) return null;
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) return null;
        const avatars = await this.assetService.findAll(ctx, {
            take: 1,
            tags: [CUSTOMER_AVATAR_TAG, this.ownerTag(customer)],
            tagsOperator: LogicalOperator.AND,
            sort: { createdAt: SortOrder.DESC },
        });
        return avatars.items[0] ?? null;
    }

    async uploadMine(ctx: RequestContext, file: Promise<CustomerAvatarUpload>): Promise<Asset> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const uploaded = await file;
        const mimeType = uploaded.mimetype.trim().toLowerCase();
        if (!isCustomerAvatarMimeType(mimeType)) {
            throw new UserInputError('头像仅支持 JPG、PNG 或 WebP 图片');
        }

        const bytes = await readAvatarUpload(uploaded);
        const extension = AVATAR_EXTENSION_BY_MIME_TYPE[mimeType];
        const asset = await this.assetService.create(ctx, {
            file: Promise.resolve({
                filename: `customer-avatar-${String(customer.id)}-${Date.now()}.${extension}`,
                mimetype: mimeType,
                encoding: uploaded.encoding ?? '7bit',
                createReadStream: () => Readable.from(bytes),
            }),
            tags: [CUSTOMER_AVATAR_TAG, this.ownerTag(customer)],
        });
        if (isGraphQlErrorResult(asset)) {
            throw new UserInputError(asset.message);
        }
        return asset;
    }

    private async activeCustomerOrThrow(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录后再更换头像');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('当前账号没有客户资料');
        return customer;
    }

    private ownerTag(customer: Customer): string {
        return `${CUSTOMER_AVATAR_OWNER_TAG_PREFIX}${String(customer.id)}`;
    }
}

function isCustomerAvatarMimeType(mimeType: string): mimeType is (typeof CUSTOMER_AVATAR_MIME_TYPES)[number] {
    return CUSTOMER_AVATAR_MIME_TYPES.includes(mimeType as (typeof CUSTOMER_AVATAR_MIME_TYPES)[number]);
}

async function readAvatarUpload(upload: CustomerAvatarUpload): Promise<Buffer> {
    const stream = upload.createReadStream();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
        for await (const chunk of stream as AsyncIterable<Buffer | string>) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > CUSTOMER_AVATAR_MAX_BYTES) {
                if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
                throw new UserInputError('头像图片不能超过 5MB');
            }
            chunks.push(buffer);
        }
    } catch (error) {
        if (error instanceof UserInputError) throw error;
        throw new UserInputError('读取头像图片失败，请重新选择');
    }
    if (size === 0) throw new UserInputError('头像图片不能为空');
    return Buffer.concat(chunks);
}
