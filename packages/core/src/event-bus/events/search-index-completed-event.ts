import { RequestContext } from '../../api/common/request-context';
import { VendureEvent } from '../vendure-event';

/** Published by the index worker only after a successful index operation. */
export class SearchIndexCompletedEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly operation: string,
    ) {
        super();
    }
}
