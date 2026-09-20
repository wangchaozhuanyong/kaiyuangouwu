import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { internal_getRequestContext, parseContext, UserInputError } from '@vendure/core';

import { AdministratorAccessService } from './administrator-access.service';

const allowedForSuspendedAccount = new Set(['Mutation.logout']);
const legacyTeamMutations = new Set([
    'Mutation.createAdministrator',
    'Mutation.updateAdministrator',
    'Mutation.assignRoleToAdministrator',
    'Mutation.deleteAdministrator',
    'Mutation.deleteAdministrators',
    'Mutation.createRole',
    'Mutation.updateRole',
    'Mutation.deleteRole',
]);
const unscopedStoreTeamQueries = new Set([
    'Query.administrator',
    'Query.administrators',
    'Query.role',
    'Query.roles',
]);

@Injectable()
export class AdministratorAccessInterceptor implements NestInterceptor {
    constructor(private readonly accessService: AdministratorAccessService) {}

    async intercept(context: ExecutionContext, next: CallHandler) {
        const parsed = parseContext(context);
        if (!parsed.isGraphQL) return next.handle();
        const requestContext = internal_getRequestContext(parsed.req, context);
        if (requestContext.apiType !== 'admin' || !requestContext.activeUserId) return next.handle();
        const rootField = `${parsed.info.parentType.name}.${parsed.info.fieldName}`;
        if (allowedForSuspendedAccount.has(rootField)) return next.handle();
        const profile = await this.accessService.findByUserId(requestContext, requestContext.activeUserId);
        if (profile?.status === 'SUSPENDED') {
            throw new UserInputError('当前管理账号已被停用，请联系上级管理员');
        }
        if (profile && legacyTeamMutations.has(rootField)) {
            throw new UserInputError('管理员与岗位权限必须通过受限管理接口操作');
        }
        if (profile?.scope === 'STORE' && unscopedStoreTeamQueries.has(rootField)) {
            throw new UserInputError('店铺账号请使用本店团队与岗位列表');
        }
        return next.handle();
    }
}
