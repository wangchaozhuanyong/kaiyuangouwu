import type {
    StorefrontContentBlock,
    StorefrontContentResult,
    StorefrontPromotionRecord,
    SystemAnnouncementRecord,
} from '../../graphql/storefront.graphql';
import { storefrontBlockInput } from './storefront-content-utils';

type BlockInput = ReturnType<typeof storefrontBlockInput>;
type WithOptionalFields<T extends { updatedFields: unknown }> = Omit<T, 'updatedFields'> &
    Partial<Pick<T, 'updatedFields'>>;
type VerificationInput = Partial<Omit<BlockInput, 'translations' | 'items'>> & {
    id?: string;
    translations?: Array<WithOptionalFields<BlockInput['translations'][number]>>;
    items?: Array<
        Omit<BlockInput['items'][number], 'translations'> & {
            translations: Array<WithOptionalFields<BlockInput['items'][number]['translations'][number]>>;
        }
    >;
};

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/** Check submitted fields only: server generated English and image URLs may differ. */
export function verifySavedBlock(
    saved: StorefrontContentBlock | null | undefined,
    input: VerificationInput,
    persisted?: StorefrontContentBlock,
): StorefrontContentBlock {
    if (!saved?.id || (input.id && saved.id !== input.id)) {
        throw new Error('保存未返回对应区块，请重新读取当前店铺确认');
    }
    const actual = storefrontBlockInput(saved);
    actual.targetType = saved.targetType;
    actual.targetValue = saved.targetValue;
    actual.items = actual.items.map((item, index) => ({
        ...item,
        position: saved.items[index].position,
        targetType: saved.items[index].targetType,
        targetValue: saved.items[index].targetValue,
    }));
    for (const [field, expected] of Object.entries(input)) {
        if (field === 'id' || field === 'translations' || field === 'items') continue;
        if (field === 'imageUrl' && input.imageAssetId) continue;
        // The server imports external images into the managed asset library.
        if (
            (field === 'imageUrl' || field === 'imageAssetId') &&
            input.imageUrl &&
            !input.imageUrl.startsWith('/assets/') &&
            !input.imageAssetId &&
            actual.imageAssetId &&
            actual.imageUrl == null
        )
            continue;
        const received = actual[field as keyof BlockInput];
        const normalize = (value: unknown) =>
            (field === 'startsAt' || field === 'endsAt') && value
                ? new Date(String(value)).toISOString()
                : value;
        if (canonical(normalize(expected)) !== canonical(normalize(received))) {
            throw new Error(`保存结果与提交内容不一致（${field}），请重新读取确认`);
        }
    }
    function translationsMatch(
        expected: Array<{ languageCode: string; updatedFields?: readonly string[]; [key: string]: unknown }>,
        received: Array<{ languageCode: string; [key: string]: unknown }>,
    ) {
        return expected.every(translation => {
            const target = received.find(value => value.languageCode === translation.languageCode);
            return (
                target &&
                Object.keys(translation).every(
                    field =>
                        field === 'updatedFields' ||
                        (translation.updatedFields &&
                            !translation.updatedFields.includes(field) &&
                            field !== 'languageCode') ||
                        canonical(translation[field]) === canonical(target[field]),
                )
            );
        });
    }
    if (input.translations && !translationsMatch(input.translations, actual.translations)) {
        throw new Error('保存后的文案与提交内容不一致，请重新读取确认');
    }
    if (input.items) {
        if (input.items.length !== actual.items.length) throw new Error('保存后的卡片数量不一致');
        for (const item of input.items) {
            const received = actual.items.find(value => value.position === item.position);
            if (
                !received ||
                (item.id && received.id !== item.id) ||
                !translationsMatch(item.translations, received.translations) ||
                Object.entries(item).some(
                    ([field, expected]) =>
                        field !== 'id' &&
                        field !== 'translations' &&
                        !(field === 'imageUrl' && item.imageAssetId) &&
                        !(
                            (field === 'imageUrl' || field === 'imageAssetId') &&
                            item.imageUrl &&
                            !item.imageUrl.startsWith('/assets/') &&
                            !item.imageAssetId &&
                            received.imageAssetId &&
                            received.imageUrl == null
                        ) &&
                        canonical(expected) !== canonical(received[field as keyof typeof received]),
                )
            ) {
                throw new Error('保存后的卡片内容不一致，请重新读取确认');
            }
        }
    }
    if (persisted) {
        const image = (value: Pick<StorefrontContentBlock, 'imageAsset' | 'imageAssetId' | 'imageUrl'>) =>
            value.imageAsset?.id ?? value.imageAssetId ?? value.imageUrl ?? null;
        if (
            image(saved) !== image(persisted) ||
            persisted.items.some(item => {
                const readback = saved.items.find(value =>
                    item.id ? value.id === item.id : value.position === item.position,
                );
                return !readback || image(readback) !== image(item);
            })
        )
            throw new Error('重新读取的图片与保存结果不一致，请刷新确认');
    }
    return saved;
}

export function verifyContentChannel(data: StorefrontContentResult | undefined, channelId: string) {
    if (!data || data.activeChannel.id !== channelId) {
        throw new Error('重新读取的店铺与保存的店铺不一致，请刷新当前店铺');
    }
    return data;
}

export function verifyContentOrder(
    blocks: Array<{ id?: string; position: number }> | undefined,
    ids: string[],
) {
    const actual = [...(blocks ?? [])].sort((a, b) => a.position - b.position).map(block => block.id);
    if (canonical(actual) !== canonical(ids)) throw new Error('楼层顺序未正确保存，请重新读取确认');
}

export function verifyAnnouncement(
    record: SystemAnnouncementRecord | undefined,
    expected: Pick<
        SystemAnnouncementRecord,
        | 'id'
        | 'enabled'
        | 'titleZh'
        | 'contentZh'
        | 'priority'
        | 'targetMode'
        | 'linkUrl'
        | 'startsAt'
        | 'endsAt'
    > & { channelIds: string[] },
) {
    if (
        !record ||
        Object.entries(expected).some(([field, value]) => {
            if (field === 'channelIds') return false;
            const actual = record[field as keyof SystemAnnouncementRecord];
            const normalize = (input: unknown) =>
                (field === 'startsAt' || field === 'endsAt') && input
                    ? new Date(String(input)).toISOString()
                    : input;
            return canonical(normalize(actual)) !== canonical(normalize(value));
        }) ||
        (expected.targetMode !== 'ALL' &&
            canonical(record.channels.map(channel => channel.id).sort()) !==
                canonical([...expected.channelIds].sort()))
    ) {
        throw new Error('公告保存后重新读取的内容或目标店铺不一致，请刷新确认');
    }
}

export function verifyPromotion(
    record: StorefrontPromotionRecord | undefined,
    expected: StorefrontPromotionRecord | null | undefined,
) {
    if (
        !record ||
        !expected ||
        ['id', 'contentType', 'draftSource', 'publishedSource', 'publishedVersion', 'isCustomized'].some(
            field =>
                canonical(record[field as keyof StorefrontPromotionRecord]) !==
                canonical(expected[field as keyof StorefrontPromotionRecord]),
        )
    )
        throw new Error('推广页保存结果与重新读取结果不一致，请刷新确认');
}
