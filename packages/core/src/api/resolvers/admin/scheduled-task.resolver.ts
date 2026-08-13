import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    LanguageCode,
    MutationRunScheduledTaskArgs,
    MutationUpdateScheduledTaskArgs,
    Permission,
} from '@vendure/common/lib/generated-types';

import { detectVendureRequestLanguage } from '../../../i18n/i18n.service';
import { SchedulerService } from '../../../scheduler/scheduler.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver()
export class ScheduledTaskResolver {
    constructor(private readonly schedulerService: SchedulerService) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadSystem)
    scheduledTasks(@Ctx() ctx: RequestContext) {
        return this.schedulerService.getTaskList(this.getDisplayLanguageCode(ctx));
    }

    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateSystem)
    updateScheduledTask(@Ctx() ctx: RequestContext, @Args() { input }: MutationUpdateScheduledTaskArgs) {
        return this.schedulerService.updateTask(input, this.getDisplayLanguageCode(ctx));
    }

    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateSystem)
    runScheduledTask(@Args() { id }: MutationRunScheduledTaskArgs) {
        return this.schedulerService.runTask(id);
    }

    private getDisplayLanguageCode(ctx: RequestContext): LanguageCode {
        return (detectVendureRequestLanguage(ctx.req ?? { query: {} }) as LanguageCode) ?? ctx.languageCode;
    }
}
