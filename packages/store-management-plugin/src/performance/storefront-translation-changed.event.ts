import { VendureEvent } from '@vendure/core';

/** SQL translation generations are already committed when the API bridge observes them. */
export class StorefrontTranslationChangedEvent extends VendureEvent {
    constructor() {
        super();
    }
}
