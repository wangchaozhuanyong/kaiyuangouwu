import { gql } from '@apollo/client';
import type { StorefrontVisualPresetConfig } from '../../../storefront-content-plugin/src/visual-presets';

export const STOREFRONT_VISUAL_PRESET_QUERY = gql`
    query NextAdminStorefrontVisualPreset {
        activeChannel {
            id
            code
            token
        }
        storefrontVisualPreset {
            channelId
            presetId
            revision
        }
    }
`;

export const UPDATE_STOREFRONT_VISUAL_PRESET_MUTATION = gql`
    mutation NextAdminUpdateStorefrontVisualPreset($input: UpdateStorefrontVisualPresetInput!) {
        updateStorefrontVisualPreset(input: $input) {
            channelId
            presetId
            revision
        }
    }
`;

export interface StorefrontVisualPresetResult {
    activeChannel: { id: string; code: string; token: string };
    storefrontVisualPreset: StorefrontVisualPresetConfig;
}
