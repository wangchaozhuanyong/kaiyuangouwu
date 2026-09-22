import type { ApolloClient } from '@apollo/client';
import { channelRequestContext } from '../../apollo';
import { UPDATE_STORE_PROFILE_MUTATION, type StoreProfileRecord } from '../../graphql/management.graphql';

export type BrandChannel = Pick<StoreProfileRecord['channel'], 'id' | 'code' | 'token'>;
export interface StoreBrandAsset {
    id: string;
    name?: string;
    preview: string;
    source: string;
    sourceChannelToken?: string;
}
export type BrandAssetField = 'logoAsset' | 'logoOnLightAsset' | 'logoOnDarkAsset';
export type BrandAssetsDraft = Record<BrandAssetField, StoreBrandAsset | null>;

export const BRAND_ASSET_SLOTS = [
    { field: 'logoAsset', label: '店铺图标', description: '方形图标，与店铺名称并排显示' },
    { field: 'logoOnLightAsset', label: '浅色背景 Logo', description: '用于浅色背景的横版品牌标识' },
    { field: 'logoOnDarkAsset', label: '深色背景 Logo', description: '用于深色背景的横版品牌标识' },
] as const;

export function storeProfileBrandAssets(profile: BrandAssetsDraft): BrandAssetsDraft {
    return Object.fromEntries(
        BRAND_ASSET_SLOTS.map(({ field }) => [field, profile[field]]),
    ) as BrandAssetsDraft;
}

/** 只保存改过的关联，并拒绝把其他店铺的素材关联到当前店铺。 */
export async function saveStoreProfileWithBrandAssets(
    client: ApolloClient,
    profile: StoreProfileRecord,
    draft: BrandAssetsDraft,
    input: Record<string, unknown>,
) {
    const targetContext = channelRequestContext(profile.channel.token);
    const changedInput: Partial<Record<`${BrandAssetField}Id`, string | null>> = {};
    for (const { field } of BRAND_ASSET_SLOTS) {
        const asset = draft[field];
        if ((asset?.id ?? null) === (profile[field]?.id ?? null)) continue;
        if (asset?.sourceChannelToken && asset.sourceChannelToken !== profile.channel.token) {
            throw new Error('所选品牌素材不属于当前店铺，请在本店素材库重新上传或选择');
        }
        changedInput[`${field}Id`] = asset?.id ?? null;
    }
    const result = await client.mutate<{ updateStoreProfile: StoreProfileRecord }>({
        mutation: UPDATE_STORE_PROFILE_MUTATION,
        variables: {
            input: { ...input, ...changedInput, id: profile.id, expectedUpdatedAt: profile.updatedAt },
        },
        context: targetContext,
    });
    if (!result.data?.updateStoreProfile?.id) throw new Error('店铺档案未返回保存结果，请刷新后核对');
    return result.data.updateStoreProfile;
}
