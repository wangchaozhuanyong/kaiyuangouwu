import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { ProductVariant, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { createHash } from 'node:crypto';
import { Brackets, In } from 'typeorm';

import { CatalogSupplier } from './entities/catalog-supplier.entity';
import { CatalogVariantSupplier } from './entities/catalog-variant-supplier.entity';
import { CatalogSupplierListOptions, CreateCatalogSupplierInput, UpdateCatalogSupplierInput } from './types';

@Injectable()
export class CatalogSupplierService {
    constructor(private readonly connection: TransactionalConnection) {}

    async findAll(ctx: RequestContext, options: CatalogSupplierListOptions = {}) {
        const skip = Math.max(0, options.skip ?? 0);
        const take = Math.min(Math.max(1, options.take ?? 50), 200);
        const query = this.connection
            .getRepository(ctx, CatalogSupplier)
            .createQueryBuilder('supplier')
            .where('supplier.channelId = :channelId', { channelId: ctx.channelId });
        if (typeof options.enabled === 'boolean') {
            query.andWhere('supplier.enabled = :enabled', { enabled: options.enabled });
        }
        const text = safeText(options.text, 255);
        if (text) {
            query.andWhere(
                new Brackets(where => {
                    where
                        .where('supplier.name LIKE :text', { text: `%${text}%` })
                        .orWhere('supplier.code LIKE :text', { text: `%${text}%` })
                        .orWhere('supplier.contactName LIKE :text', { text: `%${text}%` })
                        .orWhere('supplier.phone LIKE :text', { text: `%${text}%` });
                }),
            );
        }
        const [items, totalItems] = await query
            .orderBy('supplier.enabled', 'DESC')
            .addOrderBy('supplier.name', 'ASC')
            .skip(skip)
            .take(take)
            .getManyAndCount();
        const counts = await this.linkedCounts(
            ctx,
            items.map(item => item.id),
        );
        return {
            items: items.map(item => ({ ...item, linkedVariantCount: counts.get(String(item.id)) ?? 0 })),
            totalItems,
        };
    }

    async findOne(ctx: RequestContext, id: ID): Promise<CatalogSupplier> {
        const supplier = await this.connection.getRepository(ctx, CatalogSupplier).findOne({
            where: { id, channelId: ctx.channelId },
        });
        if (!supplier) throw new UserInputError('供货商不存在或不属于当前门店');
        return supplier;
    }

    async findOneWithLinkedCount(ctx: RequestContext, id: ID) {
        const supplier = await this.findOne(ctx, id);
        const counts = await this.linkedCounts(ctx, [supplier.id]);
        return { ...supplier, linkedVariantCount: counts.get(String(supplier.id)) ?? 0 };
    }

    async findByName(ctx: RequestContext, name: string): Promise<CatalogSupplier | null> {
        const normalizedName = normalizeSupplierName(name);
        if (!normalizedName) return null;
        return this.connection.getRepository(ctx, CatalogSupplier).findOne({
            where: { channelId: ctx.channelId, normalizedName },
        });
    }

    async findByNames(ctx: RequestContext, names: string[]): Promise<Map<string, CatalogSupplier>> {
        const normalizedNames = [...new Set(names.map(normalizeSupplierName).filter(Boolean))];
        if (normalizedNames.length === 0) return new Map();
        const items = await this.connection.getRepository(ctx, CatalogSupplier).find({
            where: { channelId: ctx.channelId, normalizedName: In(normalizedNames) },
        });
        return new Map(items.map(item => [item.normalizedName, item]));
    }

    async create(ctx: RequestContext, input: CreateCatalogSupplierInput): Promise<CatalogSupplier> {
        const name = requiredText(input.name, 255, '供货商名称');
        const normalizedName = normalizeSupplierName(name);
        const repository = this.connection.getRepository(ctx, CatalogSupplier);
        if (await repository.findOne({ where: { channelId: ctx.channelId, normalizedName } })) {
            throw new UserInputError('当前门店已存在同名供货商');
        }
        const code = input.code
            ? requiredText(input.code, 64, '供货商编码').toUpperCase()
            : await this.availableCode(ctx, normalizedName);
        if (await repository.findOne({ where: { channelId: ctx.channelId, code } })) {
            throw new UserInputError('当前门店已存在相同供货商编码');
        }
        return repository.save(
            new CatalogSupplier({
                channelId: ctx.channelId,
                code,
                name,
                normalizedName,
                enabled: input.enabled ?? true,
                contactName: optionalText(input.contactName, 120),
                phone: optionalText(input.phone, 80),
                email: optionalText(input.email, 255),
                address: optionalText(input.address, 500),
                notes: optionalText(input.notes, 10_000),
            }),
        );
    }

    async update(ctx: RequestContext, input: UpdateCatalogSupplierInput): Promise<CatalogSupplier> {
        const supplier = await this.findOne(ctx, input.id);
        const repository = this.connection.getRepository(ctx, CatalogSupplier);
        if (input.name !== undefined) {
            const name = requiredText(input.name, 255, '供货商名称');
            const normalizedName = normalizeSupplierName(name);
            const duplicate = await repository.findOne({
                where: { channelId: ctx.channelId, normalizedName },
            });
            if (duplicate && String(duplicate.id) !== String(supplier.id)) {
                throw new UserInputError('当前门店已存在同名供货商');
            }
            supplier.name = name;
            supplier.normalizedName = normalizedName;
        }
        if (input.code !== undefined) {
            const code = requiredText(input.code, 64, '供货商编码').toUpperCase();
            const duplicate = await repository.findOne({ where: { channelId: ctx.channelId, code } });
            if (duplicate && String(duplicate.id) !== String(supplier.id)) {
                throw new UserInputError('当前门店已存在相同供货商编码');
            }
            supplier.code = code;
        }
        if (typeof input.enabled === 'boolean') supplier.enabled = input.enabled;
        if (input.contactName !== undefined) supplier.contactName = optionalText(input.contactName, 120);
        if (input.phone !== undefined) supplier.phone = optionalText(input.phone, 80);
        if (input.email !== undefined) supplier.email = optionalText(input.email, 255);
        if (input.address !== undefined) supplier.address = optionalText(input.address, 500);
        if (input.notes !== undefined) supplier.notes = optionalText(input.notes, 10_000);
        return repository.save(supplier);
    }

    async ensureByName(ctx: RequestContext, name: string): Promise<CatalogSupplier | null> {
        const normalizedName = normalizeSupplierName(name);
        if (!normalizedName) return null;
        const existing = await this.findByName(ctx, name);
        if (existing) return existing;
        try {
            return await this.create(ctx, { name, enabled: true });
        } catch (error) {
            const concurrent = await this.findByName(ctx, name);
            if (concurrent) return concurrent;
            throw error;
        }
    }

    async associations(ctx: RequestContext, variantIds: ID[]): Promise<CatalogVariantSupplier[]> {
        if (variantIds.length === 0) return [];
        return this.connection.getRepository(ctx, CatalogVariantSupplier).find({
            where: { channelId: ctx.channelId, variantId: In(variantIds) },
            relations: ['supplier'],
        });
    }

    async association(ctx: RequestContext, variantId: ID): Promise<CatalogVariantSupplier | null> {
        return this.connection.getRepository(ctx, CatalogVariantSupplier).findOne({
            where: { channelId: ctx.channelId, variantId },
            relations: ['supplier'],
        });
    }

    async setVariantSupplier(
        ctx: RequestContext,
        variantId: ID,
        supplierId: ID | null,
    ): Promise<CatalogVariantSupplier | null> {
        await this.connection.getEntityOrThrow(ctx, ProductVariant, variantId, { channelId: ctx.channelId });
        const repository = this.connection.getRepository(ctx, CatalogVariantSupplier);
        const existing = await repository.findOne({ where: { channelId: ctx.channelId, variantId } });
        if (supplierId == null || String(supplierId).trim() === '') {
            if (existing) await repository.remove(existing);
            return null;
        }
        await this.findOne(ctx, supplierId);
        const association = existing ?? new CatalogVariantSupplier({ channelId: ctx.channelId, variantId });
        association.supplierId = supplierId;
        return repository.save(association);
    }

    async linkedVariants(ctx: RequestContext, supplierId: ID, skip = 0, take = 50) {
        await this.findOne(ctx, supplierId);
        const [items, totalItems] = await this.connection
            .getRepository(ctx, CatalogVariantSupplier)
            .findAndCount({
                where: { channelId: ctx.channelId, supplierId },
                relations: [
                    'variant',
                    'variant.translations',
                    'variant.product',
                    'variant.product.translations',
                ],
                order: { createdAt: 'DESC' },
                skip: Math.max(0, skip),
                take: Math.min(Math.max(1, take), 200),
            });
        return {
            items: items.map(item => ({
                id: String(item.variantId),
                sku: item.variant.sku,
                name: item.variant.name,
                productId: String(item.variant.productId),
                productName: item.variant.product?.name ?? item.variant.name,
                enabled: item.variant.enabled,
            })),
            totalItems,
        };
    }

    async disableIfUnused(ctx: RequestContext, supplierId: ID): Promise<void> {
        const links = await this.connection.getRepository(ctx, CatalogVariantSupplier).count({
            where: { channelId: ctx.channelId, supplierId },
        });
        if (links === 0) {
            await this.connection
                .getRepository(ctx, CatalogSupplier)
                .update({ id: supplierId, channelId: ctx.channelId }, { enabled: false });
        }
    }

    private async linkedCounts(ctx: RequestContext, supplierIds: ID[]): Promise<Map<string, number>> {
        if (supplierIds.length === 0) return new Map();
        const rows = await this.connection
            .getRepository(ctx, CatalogVariantSupplier)
            .createQueryBuilder('binding')
            .select('binding.supplierId', 'supplierId')
            .addSelect('COUNT(binding.id)', 'count')
            .where('binding.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('binding.supplierId IN (:...supplierIds)', { supplierIds })
            .groupBy('binding.supplierId')
            .getRawMany<{ supplierId: string; count: string }>();
        return new Map(rows.map(row => [String(row.supplierId), Number(row.count)]));
    }

    private async availableCode(ctx: RequestContext, normalizedName: string): Promise<string> {
        const base = `SUP-${createHash('sha256').update(normalizedName).digest('hex').slice(0, 10).toUpperCase()}`;
        const repository = this.connection.getRepository(ctx, CatalogSupplier);
        for (let suffix = 0; suffix < 100; suffix++) {
            const code = suffix === 0 ? base : `${base}-${suffix}`;
            if (!(await repository.findOne({ where: { channelId: ctx.channelId, code } }))) return code;
        }
        throw new UserInputError('无法生成唯一供货商编码，请手动填写编码');
    }
}

export function normalizeSupplierName(value: string): string {
    const normalized = safeText(value, 255).toLocaleLowerCase('zh-Hans');
    if (['', '-', '无', '无供应商', '无供货商', 'none', 'null'].includes(normalized)) return '';
    return normalized.replace(/\s+/gu, ' ');
}

export function normalizeSupplierDisplayName(value: string): string {
    return normalizeSupplierName(value) ? safeText(value, 255) : '';
}

function requiredText(value: string, max: number, label: string): string {
    const result = safeText(value, max);
    if (!result) throw new UserInputError(`${label}不能为空`);
    return result;
}

function optionalText(value: string | null | undefined, max: number): string | null {
    const result = safeText(value, max);
    return result || null;
}

function safeText(value: unknown, max: number): string {
    return (typeof value === 'string' ? value : '')
        .normalize('NFKC')
        .replace(/\0/gu, '')
        .trim()
        .slice(0, max);
}
