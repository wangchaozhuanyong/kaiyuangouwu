import { gql } from '@apollo/client';
import { REFERRAL_PROGRAM_FRAGMENT, type ReferralProgramResult } from './marketing.graphql';

export const SHARING_SETTINGS_QUERY = gql`
    query AdminSharingSettings {
        activeChannel {
            id
            code
            defaultCurrencyCode
        }
        referralProgram {
            ...AdminReferralProgramFields
        }
    }
    ${REFERRAL_PROGRAM_FRAGMENT}
`;

export type SharingSettingsResult = Pick<ReferralProgramResult, 'activeChannel' | 'referralProgram'>;
