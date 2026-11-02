import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
/** Nullable evidence only. Existing source bodies and publications stay intact. */
export class AddBlogSourceMetadata1793577660000 implements MigrationInterface {
    async up(runner: QueryRunner) {
        if (!(await runner.hasColumn('news_blog_source_item', 'metadataJson')))
            await runner.addColumn(
                'news_blog_source_item',
                new TableColumn({ name: 'metadataJson', type: 'text', isNullable: true }),
            );
    }
    down(): Promise<void> {
        return Promise.reject(new Error('Retain news source provenance; no destructive rollback'));
    }
}
