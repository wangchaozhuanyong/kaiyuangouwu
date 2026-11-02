import { Injectable } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { EditorialProviderService } from '@vendure/image-generation-plugin';
import { request } from 'node:https';

import { SkillDeferred } from './skill-deferral';
import { BlogSkillState } from './skill-entities';

/** Anonymous public reads only. A persisted global limit protects all merchant workers. */
@Injectable()
export class BlogSkillsHttp {
    constructor(
        private readonly provider: EditorialProviderService,
        private readonly connection: TransactionalConnection,
    ) {}
    async state() {
        const repo = this.connection.rawConnection.getRepository(BlogSkillState);
        let row = await repo.findOneBy({ code: 'catalog' });
        if (!row) {
            try {
                row = await repo.save(
                    new BlogSkillState({
                        code: 'catalog',
                        requestCount: 0,
                        message: '',
                        leaseUntil: null,
                        lastCollectedAt: null,
                        requestWindow: null,
                    }),
                );
            } catch {
                row = await repo.findOneByOrFail({ code: 'catalog' });
            }
        }
        return row;
    }
    async read(url: string, hops = 0, purpose: 'discovery' | 'publication' = 'publication'): Promise<string> {
        const u = new URL(url);
        if (
            u.protocol !== 'https:' ||
            u.username ||
            u.password ||
            u.port ||
            hops > 3 ||
            !['www.skills.sh', 'skills.sh', 'api.github.com'].includes(u.hostname)
        )
            throw new Error('Skill 来源不在白名单');
        if (
            u.hostname.includes('skills.sh') &&
            !['/', '/trending', '/hot', '/robots.txt'].includes(u.pathname)
        )
            throw new Error('仅采集公开技能榜单');
        if (u.hostname === 'api.github.com') {
            await this.state();
            const repo = this.connection.rawConnection.getRepository(BlogSkillState);
            const now = new Date();
            await repo
                .createQueryBuilder()
                .update()
                .set({ requestWindow: new Date(now.getTime() + 3600000), requestCount: 0 })
                .where('code = :code', { code: 'catalog' })
                .andWhere('(requestWindow IS NULL OR requestWindow <= :now)', { now })
                .execute();
            const claimed = await repo
                .createQueryBuilder()
                .update()
                .set({ requestCount: () => 'requestCount + 1' })
                .where('code = :code', { code: 'catalog' })
                .andWhere('requestCount < :limit', { limit: purpose === 'discovery' ? 32 : 40 })
                .execute();
            if (claimed.affected !== 1)
                throw new SkillDeferred((await this.state()).requestWindow ?? new Date(Date.now() + 3600000));
        }
        const target = await this.provider.safeUrls.resolveForRequest(url, false);
        const result = await new Promise<{
            status: number;
            location?: string;
            body: string;
            retry?: string;
            reset?: string;
        }>((resolve, reject) => {
            const req = request(
                target.url,
                {
                    signal: AbortSignal.timeout(15000),
                    method: 'GET',
                    lookup: (_name, options, done) =>
                        options.all
                            ? done(null, [{ address: target.address, family: target.family }] as never)
                            : done(null, target.address, target.family),
                    headers: {
                        'User-Agent': 'VendureNewsBlog/1.0',
                        Accept:
                            u.hostname === 'api.github.com'
                                ? 'application/vnd.github+json'
                                : 'text/html,text/plain',
                    },
                },
                res => {
                    let size = 0;
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => {
                        size += chunk.length;
                        if (size > 2000000) {
                            res.destroy();
                            reject(new Error('Skill 资料超过大小限制'));
                        } else chunks.push(chunk);
                    });
                    res.on('end', () =>
                        resolve({
                            status: res.statusCode ?? 0,
                            location: res.headers.location,
                            body: Buffer.concat(chunks).toString('utf8'),
                            retry: String(res.headers['retry-after'] ?? ''),
                            reset: String(res.headers['x-ratelimit-reset'] ?? ''),
                        }),
                    );
                    res.on('error', () => reject(new Error('Skill 来源读取中断')));
                },
            );
            req.on('error', () => reject(new Error('Skill 来源读取失败')));
            req.end();
        });
        if ([301, 302, 303, 307, 308].includes(result.status) && result.location)
            return this.read(new URL(result.location, url).href, hops + 1, purpose);
        if ([403, 429].includes(result.status) && u.hostname === 'api.github.com') {
            const prior = await this.state();
            const reset = Math.max(
                prior.requestWindow?.getTime() ?? 0,
                Date.now() + 60000,
                Number(result.reset) * 1000 || 0,
                Date.now() + (Number(result.retry) || 60) * 1000,
            );
            await this.connection.rawConnection
                .getRepository(BlogSkillState)
                .update({ code: 'catalog' }, { requestCount: 40, requestWindow: new Date(reset) });
        }
        if ([403, 429].includes(result.status) && u.hostname === 'api.github.com')
            throw new SkillDeferred((await this.state()).requestWindow ?? new Date(Date.now() + 3600000));
        if (result.status !== 200) throw new Error(`Skill 来源暂不可用（HTTP ${result.status}）`);
        return result.body;
    }
    async json<T>(path: string, purpose: 'discovery' | 'publication' = 'publication'): Promise<T> {
        if (
            !/^\/repos\/[\w.-]+\/[\w.-]+\//u.test(path + '/') ||
            path.includes('..') ||
            path.includes('#') ||
            (path.includes('?') && !/\?(?:recursive=1|ref=[a-f0-9]{40})$/u.test(path))
        )
            throw new Error('GitHub 请求路径无效');
        return JSON.parse(await this.read(`https://api.github.com${path}`, 0, purpose)) as T;
    }
}
