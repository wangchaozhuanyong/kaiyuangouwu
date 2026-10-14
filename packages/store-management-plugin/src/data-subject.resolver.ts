import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';

import {
    DataSubjectAction,
    DataSubjectVerification,
    DataSubjectVerificationService,
} from './data-subject-verification.service';
import { DataSubjectService } from './data-subject.service';

@Resolver()
export class DataSubjectShopResolver {
    constructor(
        private readonly dataSubjects: DataSubjectService,
        private readonly verification: DataSubjectVerificationService,
    ) {}

    @Mutation()
    @Allow(Permission.Authenticated)
    requestMyDataSubjectVerification(@Ctx() ctx: RequestContext, @Args('action') action: DataSubjectAction) {
        return this.verification.start(ctx, action);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myDataSubjectRequests(@Ctx() ctx: RequestContext) {
        return this.dataSubjects.myRequests(ctx);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    exportMyPersonalData(
        @Ctx() ctx: RequestContext,
        @Args('password') password: string,
        @Args('verification') verification?: DataSubjectVerification,
    ) {
        return this.dataSubjects.exportMine(ctx, password, verification);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    requestMyAccountClosure(
        @Ctx() ctx: RequestContext,
        @Args('password') password: string,
        @Args('verification') verification?: DataSubjectVerification,
    ) {
        return this.dataSubjects.requestAccountClosure(ctx, password, verification);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    cancelMyAccountClosure(@Ctx() ctx: RequestContext) {
        return this.dataSubjects.cancelAccountClosure(ctx);
    }
}

@Resolver()
export class DataSubjectAdminResolver {
    constructor(private readonly dataSubjects: DataSubjectService) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    dataSubjectRequests(@Ctx() ctx: RequestContext) {
        return this.dataSubjects.listRequests(ctx);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    retryDataSubjectRequest(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.dataSubjects.retry(ctx, id);
    }
}
