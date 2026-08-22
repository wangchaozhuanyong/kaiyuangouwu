import { Injectable } from '@angular/core';
import {
    ApolloCache,
    MutationUpdaterFunction,
    OperationVariables,
    WatchQueryFetchPolicy,
} from '@apollo/client/core';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { simpleDeepClone } from '@vendure/common/lib/simple-deep-clone';
import { Apollo } from 'apollo-angular';
import { DocumentNode } from 'graphql/language/ast';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { CustomFieldConfig } from '../../common/generated-types';
import { QueryResult } from '../query-result';
import { ServerConfigService } from '../server-config';
import { addCustomFields } from '../utils/add-custom-fields';
import { isEntityCreateOrUpdateMutation } from '../utils/is-entity-create-or-update-mutation';
import { removeReadonlyCustomFields } from '../utils/remove-readonly-custom-fields';
import { transformRelationCustomFieldInputs } from '../utils/transform-relation-custom-field-inputs';

/**
 * @description
 * Additional options that can be passed to the `query` and `mutate` methods.
 *
 * @since 3.0.4
 */
export interface ExtendedQueryOptions {
    /**
     * @description
     * An array of custom field names which should be included in the query or mutation
     * return data. The automatic inclusion of custom fields is only supported for
     * entities which are defined as Fragments in the DocumentNode.
     *
     * @since 3.0.4
     */
    includeCustomFields?: string[];
}

@Injectable()
export class BaseDataService {
    constructor(
        private apollo: Apollo,
        private serverConfigService: ServerConfigService,
    ) {}

    private get customFields(): Map<string, CustomFieldConfig[]> {
        return this.serverConfigService.customFieldsMap;
    }

    /**
     * Performs a GraphQL watch query
     */
    query<T, V extends OperationVariables = OperationVariables>(
        query: DocumentNode | TypedDocumentNode<T, V>,
        variables?: V,
        fetchPolicy: WatchQueryFetchPolicy = 'cache-and-network',
        options: ExtendedQueryOptions = {},
    ): QueryResult<T, V> {
        const queryOptions = {
            query: addCustomFields(query, this.customFields, options.includeCustomFields),
            fetchPolicy,
            ...(variables === undefined ? {} : { variables }),
        } as Apollo.WatchQueryOptions<T, V>;
        const queryRef = this.apollo.watchQuery<T, V>(queryOptions);

        const queryResult = new QueryResult<T, V>(queryRef, this.apollo, this.customFields);
        return queryResult;
    }

    /**
     * Performs a GraphQL mutation
     */
    mutate<T, V extends OperationVariables = OperationVariables>(
        mutation: DocumentNode | TypedDocumentNode<T, V>,
        variables?: V,
        update?: MutationUpdaterFunction<T, V, ApolloCache>,
        options: ExtendedQueryOptions = {},
    ): Observable<T> {
        const withCustomFields = addCustomFields(mutation, this.customFields, options.includeCustomFields);
        const withoutReadonlyFields = this.prepareCustomFields(mutation, variables);

        const mutationOptions = {
            mutation: withCustomFields,
            update,
            ...(withoutReadonlyFields === undefined ? {} : { variables: withoutReadonlyFields }),
        } as Apollo.MutateOptions<T, V>;

        return this.apollo.mutate<T, V>(mutationOptions).pipe(map(result => result.data as T));
    }

    private prepareCustomFields<V>(mutation: DocumentNode, variables: V): V {
        const entity = isEntityCreateOrUpdateMutation(mutation);
        if (entity) {
            const customFieldConfig = this.customFields.get(entity);
            if (variables && customFieldConfig) {
                // These legacy custom-field helpers intentionally accept heterogeneous GraphQL inputs.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let variablesClone = simpleDeepClone(variables as any);
                variablesClone = removeReadonlyCustomFields(variablesClone, customFieldConfig);
                variablesClone = transformRelationCustomFieldInputs(variablesClone, customFieldConfig);
                return variablesClone;
            }
        }
        return variables;
    }
}
