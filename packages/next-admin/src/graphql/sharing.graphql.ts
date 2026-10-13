import { gql } from '@apollo/client';
import { REFERRAL_PROGRAM_FRAGMENT, type ReferralProgramResult } from './marketing.graphql';

export const SHARING_SETTINGS_QUERY = gql`
    query AdminSharingSettings($includeStoreProfile: Boolean! = false) {
        activeChannel {
            id
            code
            defaultCurrencyCode
            customFields {
                storefrontNameZh
                storefrontNameEn
            }
        }
        myStoreProfile @include(if: $includeStoreProfile) {
            id
            channel {
                id
            }
            storefrontUrl
            logoAsset {
                id
                preview
                source
            }
        }
        referralProgram {
            ...AdminReferralProgramFields
        }
    }
    ${REFERRAL_PROGRAM_FRAGMENT}
`;

export type SharingSettingsResult = Pick<ReferralProgramResult, 'activeChannel' | 'referralProgram'> & {
    myStoreProfile?: {
        id: string;
        channel: { id: string };
        storefrontUrl: string | null;
        logoAsset: { id: string; source: string; preview: string } | null;
    } | null;
};
