import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import {
    StorefrontContentBlockType,
    StorefrontContentLayoutVariant,
    StorefrontContentTargetType,
} from './constants';

export type StorefrontContentSettingScalar = string | number | boolean | null;
export type StorefrontContentSettingsValue = Record<
    string,
    StorefrontContentSettingScalar | StorefrontContentSettingScalar[]
>;

export interface StorefrontContentBlockTranslationInput {
    languageCode: LanguageCode;
    title: string;
    subtitle?: string | null;
    body?: string | null;
    ctaLabel?: string | null;
}

export interface StorefrontContentItemTranslationInput {
    languageCode: LanguageCode;
    label: string;
    description?: string | null;
}

export interface StorefrontContentItemInput {
    id?: ID | null;
    enabled?: boolean | null;
    position: number;
    imageAssetId?: ID | null;
    imageUrl?: string | null;
    targetType?: StorefrontContentTargetType | null;
    targetValue?: string | null;
    settings?: StorefrontContentSettingsValue | null;
    translations: StorefrontContentItemTranslationInput[];
}

export interface StorefrontContentBlockFieldsInput {
    code: string;
    internalName?: string | null;
    type: StorefrontContentBlockType;
    layoutVariant?: StorefrontContentLayoutVariant | null;
    enabled?: boolean | null;
    position: number;
    startsAt?: Date | null;
    endsAt?: Date | null;
    imageAssetId?: ID | null;
    imageUrl?: string | null;
    backgroundColor?: string | null;
    textColor?: string | null;
    targetType?: StorefrontContentTargetType | null;
    targetValue?: string | null;
    settings?: StorefrontContentSettingsValue | null;
    translations: StorefrontContentBlockTranslationInput[];
    items?: StorefrontContentItemInput[] | null;
}

export type CreateStorefrontContentBlockInput = StorefrontContentBlockFieldsInput;

export interface UpdateStorefrontContentBlockInput extends Partial<
    Omit<StorefrontContentBlockFieldsInput, 'translations' | 'items'>
> {
    id: ID;
    expectedUpdatedAt: Date;
    translations?: StorefrontContentBlockTranslationInput[] | null;
    items?: StorefrontContentItemInput[] | null;
}

export interface UpdateStorefrontContentSettingsInput {
    heroAutoplayIntervalSeconds: number;
}

export interface StorefrontContentBlockVersionInput {
    id: ID;
    expectedUpdatedAt: Date;
}

export interface ApplyStorefrontContentChangesInput {
    expectedBlocks: StorefrontContentBlockVersionInput[];
    creates: CreateStorefrontContentBlockInput[];
    updates: UpdateStorefrontContentBlockInput[];
    orderedCodes?: string[] | null;
}
