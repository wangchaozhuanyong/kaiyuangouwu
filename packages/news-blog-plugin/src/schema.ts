import gql from 'graphql-tag';
export const adminSchema = gql`
    type NewsBlogArticleAdmin {
        id: ID!
        slug: String!
        version: Int!
        state: String!
        publishedAt: DateTime
        draft: JSON!
        published: JSON
        issues: [String!]!
    }
    type NewsBlogSource {
        id: ID!
        code: String!
        name: String!
        url: String!
        enabled: Boolean!
        version: Int!
        status: String!
        message: String!
        lastCollectedAt: DateTime
    }
    type NewsBlogSourceItem {
        id: ID!
        sourceCode: String!
        url: String!
        title: String!
        body: String!
        category: String!
        status: String!
        sourcePublishedAt: DateTime!
        fetchedAt: DateTime!
        evidenceMode: String!
    }
    type NewsBlogRun {
        id: ID!
        requestKey: String!
        kind: String!
        state: String!
        budgetDate: String!
        reservedMicros: Int!
        chargedMicros: Int!
        message: String!
        telemetryJson: String
        createdAt: DateTime!
        completedAt: DateTime
    }
    type NewsBlogRevision {
        id: ID!
        version: Int!
        action: String!
        actorId: String!
        createdAt: DateTime!
        snapshotJson: String
    }
    type NewsBlogProviderOption {
        code: String!
        name: String!
        textModel: String!
    }
    input NewsBlogAdminListInput {
        term: String
        state: String
        skip: Int
        take: Int
    }
    type NewsBlogAdminList {
        items: [NewsBlogArticleAdmin!]!
        totalItems: Int!
    }
    extend type Query {
        newsBlogArticleList(input: NewsBlogAdminListInput): NewsBlogAdminList!
        newsBlogSettings: JSON!
        newsBlogSources: [NewsBlogSource!]!
        newsBlogSourceItems: [NewsBlogSourceItem!]!
        newsBlogArticles(state: String): [NewsBlogArticleAdmin!]!
        newsBlogArticle(id: ID!): NewsBlogArticleAdmin!
        newsBlogHistory(id: ID!): [NewsBlogRevision!]!
        newsBlogRuns: [NewsBlogRun!]!
        newsBlogProviderOptions: [NewsBlogProviderOption!]!
    }
    input SaveNewsBlogArticleInput {
        id: ID
        slug: String!
        expectedVersion: Int!
        draft: JSON!
    }
    input RequestNewsBlogTaskInput {
        kind: String!
        requestKey: String!
        articleId: ID
        expectedVersion: Int
        sourceIds: [ID!]
        sectionIndex: Int
        templateOnly: Boolean
        historyStart: String
        historyEnd: String
    }
    extend type Mutation {
        reconcileNewsBlogRun(id: ID!, actualCostMicros: Int!): NewsBlogRun!
        retryNewsBlogTask(id: ID!, requestKey: String!): NewsBlogRun!
        saveNewsBlogSettings(settings: JSON!, expectedVersion: Int!): JSON!
        saveNewsBlogSource(code: String!, enabled: Boolean!, expectedVersion: Int!): [NewsBlogSource!]!
        saveNewsBlogArticle(input: SaveNewsBlogArticleInput!): NewsBlogArticleAdmin!
        requestNewsBlogTask(input: RequestNewsBlogTaskInput!): NewsBlogRun!
        publishNewsBlogArticle(id: ID!, expectedVersion: Int!, acceptIssues: Boolean!): NewsBlogArticleAdmin!
        withdrawNewsBlogArticle(id: ID!, expectedVersion: Int!): NewsBlogArticleAdmin!
    }
`;
export const shopSchema = gql`
    type NewsBlogPublicArticle {
        id: ID!
        slug: String!
        title: String!
        summary: String!
        body: String!
        category: String!
        format: String!
        tags: [String!]!
        publishedAt: String!
        reviewedAt: String
        reviewerName: String
        publicationMode: String
        updatedAt: String
        skill: JSON
        readingMinutes: Int!
        cover: JSON
        sources: JSON!
        illustrations: JSON!
    }
    type NewsBlogPublicList {
        title: String!
        description: String!
        items: [NewsBlogPublicArticle!]!
        totalItems: Int!
        featured: NewsBlogPublicArticle
    }
    input NewsBlogListInput {
        term: String
        category: String
        skip: Int
        take: Int
    }
    extend type Query {
        newsBlogArticles(input: NewsBlogListInput): NewsBlogPublicList!
        newsBlogArticle(slug: String!): NewsBlogPublicArticle
    }
`;
