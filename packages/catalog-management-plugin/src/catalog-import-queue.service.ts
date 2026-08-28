import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Job,
    JobQueue,
    JobQueueService,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';

import { CatalogImportService } from './catalog-import.service';
import { CATALOG_IMPORT_QUEUE } from './constants';
import { CatalogImportJob } from './entities/catalog-import-job.entity';

interface CatalogImportQueueData {
    importJobId: string;
}

@Injectable()
export class CatalogImportQueueService implements OnApplicationBootstrap {
    private queue: JobQueue<CatalogImportQueueData>;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly requestContextService: RequestContextService,
        private readonly jobQueueService: JobQueueService,
        private readonly imports: CatalogImportService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.queue = await this.jobQueueService.createQueue({
            name: CATALOG_IMPORT_QUEUE,
            process: job => this.process(job),
        });
        this.imports.registerEnqueuer(jobId => this.dispatch(jobId));
        await this.recoverInterruptedJobs();
    }

    async dispatch(jobId: ID): Promise<void> {
        await this.queue.add({ importJobId: String(jobId) }, { retries: 2 });
    }

    private async process(job: Job<CatalogImportQueueData>): Promise<{ importJobId: string }> {
        const importJob = await this.connection.rawConnection.getRepository(CatalogImportJob).findOne({
            where: { id: job.data.importJobId as ID },
            relations: ['channel'],
        });
        if (!importJob || importJob.state !== 'QUEUED') return { importJobId: job.data.importJobId };
        const ctx = await this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: importJob.channel,
        });
        await this.imports.executeJob(ctx, importJob.id, progress => job.setProgress(progress));
        return { importJobId: job.data.importJobId };
    }

    private async recoverInterruptedJobs(): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(CatalogImportJob);
        const interrupted = await repository.find({
            where: [{ state: 'QUEUED' }, { state: 'RUNNING' }],
            take: 100,
        });
        for (const job of interrupted) {
            if (job.state === 'RUNNING') {
                job.state = 'QUEUED';
                job.errorMessage = '服务重启后已自动恢复导入';
                await repository.save(job);
            }
            await this.dispatch(job.id);
        }
    }
}
