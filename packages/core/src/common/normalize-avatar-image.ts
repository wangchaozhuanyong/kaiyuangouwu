import { processCustomerImage } from './process-customer-image';

/** Normalize the complete upload before passing it to AssetService. */
export function normalizeAvatarImage(bytes: Buffer): Promise<Buffer> {
    return processCustomerImage(bytes, 'avatar');
}
