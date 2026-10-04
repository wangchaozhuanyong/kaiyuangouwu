import { ApolloLink, Observable } from '@apollo/client';
import { getOperationAST } from 'graphql';

/** Only managed reads are bounded. This link never replays a write or an imperative export. */
export const adminReadTimeoutLink = new ApolloLink((operation, forward) => {
    if (!operation.getContext().adminManagedRead || getOperationAST(operation.query)?.operation !== 'query')
        return forward(operation);
    return new Observable(observer => {
        let subscription: { unsubscribe(): void } | undefined;
        const timeout = setTimeout(() => {
            subscription?.unsubscribe();
            const error = Object.assign(new Error('数据读取超时，请重试当前页面'), {
                extensions: { code: 'TIMEOUT' },
            });
            observer.error(error);
        }, 45_000);
        try {
            subscription = forward(operation).subscribe({
                next: result => observer.next(result),
                error: error => {
                    clearTimeout(timeout);
                    observer.error(error);
                },
                complete: () => {
                    clearTimeout(timeout);
                    observer.complete();
                },
            });
        } catch (error) {
            clearTimeout(timeout);
            observer.error(error);
        }
        return () => {
            clearTimeout(timeout);
            subscription?.unsubscribe();
        };
    });
});
