import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, ConfigService, Ctx, Permission, RequestContext, setSessionToken } from '@vendure/core';
import { Request, Response } from 'express';

import { AdminLoginResult, AdminTwoFactorService } from './admin-two-factor.service';

@Resolver()
export class AdminTwoFactorResolver {
    constructor(
        private readonly security: AdminTwoFactorService,
        private readonly config: ConfigService,
    ) {}

    @Mutation()
    @Allow(Permission.Public)
    async adminBeginLogin(
        @Ctx() ctx: RequestContext,
        @Args('username') username: string,
        @Args('password') password: string,
        @Args('rememberMe') rememberMe: boolean,
        @Context('req') req: Request,
        @Context('res') res: Response,
    ) {
        return this.loginResponse(
            await this.security.beginLogin(ctx, username, password, rememberMe, this.ip(req)),
            req,
            res,
        );
    }

    @Mutation()
    @Allow(Permission.Public)
    async adminCompleteTwoFactorLogin(
        @Ctx() ctx: RequestContext,
        @Args('challengeToken') token: string,
        @Args('code') code: string,
        @Context('req') req: Request,
        @Context('res') res: Response,
    ) {
        return this.loginResponse(
            await this.security.completeLogin(ctx, token, code, this.ip(req)),
            req,
            res,
        );
    }

    @Query()
    @Allow(Permission.Authenticated)
    adminTwoFactorStatus(@Ctx() ctx: RequestContext) {
        return this.security.status(ctx);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    adminBeginTwoFactorSetup(
        @Ctx() ctx: RequestContext,
        @Args('password') password: string,
        @Args('code') code?: string,
    ) {
        return this.security.beginSetup(ctx, password, code);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    adminConfirmTwoFactorSetup(
        @Ctx() ctx: RequestContext,
        @Args('password') password: string,
        @Args('code') code: string,
    ) {
        return this.security.confirmSetup(ctx, password, code);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    adminDisableTwoFactor(
        @Ctx() ctx: RequestContext,
        @Args('password') password: string,
        @Args('code') code: string,
    ) {
        return this.security.disable(ctx, password, code);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    adminRegenerateTwoFactorRecoveryCodes(
        @Ctx() ctx: RequestContext,
        @Args('password') password: string,
        @Args('code') code: string,
    ) {
        return this.security.regenerateRecoveryCodes(ctx, password, code);
    }

    private ip(req: Request) {
        return req.ip || req.socket.remoteAddress || 'unknown';
    }

    private loginResponse(result: AdminLoginResult, req: Request, res: Response) {
        res.setHeader('Cache-Control', 'no-store');
        if (result.status === 'SUCCESS' && result.session) {
            setSessionToken({
                req,
                res,
                authOptions: this.config.authOptions,
                sessionToken: result.session.token,
                rememberMe: result.rememberMe ?? false,
            });
        }
        return result;
    }
}
