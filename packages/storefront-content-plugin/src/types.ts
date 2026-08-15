import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { StorefrontContentBlockType, StorefrontContentTargetType } from './constants';

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
    imageUrl?: string | null;
    targetType?: StorefrontContentTargetType | null;
    targetValue?: string | null;
    translations: StorefrontContentItemTranslationInput[];
}

export interface StorefrontContentBlockFieldsInput {
    code: string;
    type: StorefrontContentBlockType;
    enabled?: boolean | null;
    position: number;
    startsAt?: Date | null;
    endsAt?: Date | null;
    imageUrl?: string | null;
    backgroundColor?: string | null;
    textColor?: string | null;
    targetType?: StorefrontContentTargetType | null;
    targetValue?: string | null;
    translations: StorefrontContentBlockTranslationInput[];
    items?: StorefrontContentItemInput[] | null;
}

export interface CreateStorefrontContentBlockInput extends StorefrontContentBlockFieldsInput {}

export interface UpdateStorefrontContentBlockInput extends Partial<
    Omit<StorefrontContentBlockFieldsInput, 'translations' | 'items'>
> {
    id: ID;
    translations?: StorefrontContentBlockTranslationInput[] | null;
    items?: StorefrontContentItemInput[] | null;
}
