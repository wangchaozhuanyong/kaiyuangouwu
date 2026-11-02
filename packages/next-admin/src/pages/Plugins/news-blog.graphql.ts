import { gql } from '@apollo/client';
export const NEWS_BLOG_WORKSPACE = gql`
    query NewsBlogWorkspace($input: NewsBlogAdminListInput) {
        newsBlogSettings
        newsBlogArticleList(input: $input) {
            totalItems
            items {
                id
                slug
                version
                state
                publishedAt
                draft
                published
                issues
            }
        }
    }
`;
export const NEWS_BLOG_ARTICLE = gql`
    query NewsBlogArticle($id: ID!) {
        newsBlogArticle(id: $id) {
            id
            slug
            version
            state
            publishedAt
            draft
            published
            issues
        }
        newsBlogHistory(id: $id) {
            id
            version
            action
            actorId
            createdAt
            snapshotJson
        }
    }
`;
export const NEWS_BLOG_SOURCES = gql`
    query NewsBlogSources {
        newsBlogSources {
            id
            code
            name
            url
            enabled
            version
            status
            message
            lastCollectedAt
        }
        newsBlogSourceItems {
            id
            sourceCode
            url
            title
            body
            category
            status
            sourcePublishedAt
            fetchedAt
        }
    }
`;
export const NEWS_BLOG_RUNS = gql`
    query NewsBlogRuns {
        newsBlogRuns {
            id
            kind
            state
            budgetDate
            reservedMicros
            chargedMicros
            message
            telemetryJson
            createdAt
            completedAt
        }
    }
`;
export const NEWS_BLOG_PROVIDERS = gql`
    query NewsBlogProviders {
        newsBlogProviderOptions {
            code
            name
            textModel
        }
    }
`;
export const SAVE_NEWS_BLOG_SETTINGS = gql`
    mutation SaveNewsBlogSettings($settings: JSON!, $expectedVersion: Int!) {
        saveNewsBlogSettings(settings: $settings, expectedVersion: $expectedVersion)
    }
`;
export const SAVE_NEWS_BLOG_SOURCE = gql`
    mutation SaveNewsBlogSource($code: String!, $enabled: Boolean!, $expectedVersion: Int!) {
        saveNewsBlogSource(code: $code, enabled: $enabled, expectedVersion: $expectedVersion) {
            id
            enabled
            version
        }
    }
`;
export const SAVE_NEWS_BLOG_ARTICLE = gql`
    mutation SaveNewsBlogArticle($input: SaveNewsBlogArticleInput!) {
        saveNewsBlogArticle(input: $input) {
            id
            slug
            version
            state
            draft
            published
            issues
        }
    }
`;
export const REQUEST_NEWS_BLOG_TASK = gql`
    mutation RequestNewsBlogTask($input: RequestNewsBlogTaskInput!) {
        requestNewsBlogTask(input: $input) {
            id
            kind
            state
            message
        }
    }
`;
export const PUBLISH_NEWS_BLOG_ARTICLE = gql`
    mutation PublishNewsBlogArticle($id: ID!, $expectedVersion: Int!, $acceptIssues: Boolean!) {
        publishNewsBlogArticle(id: $id, expectedVersion: $expectedVersion, acceptIssues: $acceptIssues) {
            id
            slug
            version
            state
            draft
            published
            issues
        }
    }
`;
export const WITHDRAW_NEWS_BLOG_ARTICLE = gql`
    mutation WithdrawNewsBlogArticle($id: ID!, $expectedVersion: Int!) {
        withdrawNewsBlogArticle(id: $id, expectedVersion: $expectedVersion) {
            id
            slug
            version
            state
            draft
            published
            issues
        }
    }
`;

export const RETRY_NEWS_BLOG_TASK = gql`
    mutation RetryNewsBlogTask($id: ID!, $requestKey: String!) {
        retryNewsBlogTask(id: $id, requestKey: $requestKey) {
            id
            kind
            state
            message
        }
    }
`;

export const RECONCILE_NEWS_BLOG_RUN = gql`
    mutation ReconcileNewsBlogRun($id: ID!, $actualCostMicros: Int!) {
        reconcileNewsBlogRun(id: $id, actualCostMicros: $actualCostMicros) {
            id
            state
            message
        }
    }
`;
