import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * Standalone prompt-optimization model configuration.
 *
 * Each row holds its own API Key, base URL, and model ID – completely
 * independent from the image-generation provider credentials
 * ({@link ImageProviderCredential}).
 *
 * The service picks from the pool of enabled, healthy rows using
 * priority + smooth weighted round-robin, identical to how image
 * provider credentials are routed.
 */
@Entity({ name: 'image_prompt_model_config' })
@Index('IDX_image_prompt_model_config_code', ['code'], { unique: true })
@Index('IDX_image_prompt_model_config_priority', ['enabled', 'priority'])
export class ImagePromptModelConfig extends VendureEntity {
    constructor(input?: DeepPartial<ImagePromptModelConfig>) {
        super(input);
    }

    /** Stable human-readable code, e.g. 'gemini-flash-prompt'. */
    @Column({ type: 'varchar', length: 64 })
    code: string;

    /** Friendly display name, e.g. '提示词优化 - Gemini Flash'. */
    @Column({ type: 'varchar', length: 120 })
    name: string;

    @Column('boolean', { default: false })
    enabled: boolean;

    /** Relay / API base URL, e.g. 'https://relay.example.com/v1'. */
    @Column({ type: 'varchar', length: 500 })
    baseUrl: string;

    /** AES-256-GCM encrypted API Key (same cipher as provider credentials). */
    @Column({ type: 'text' })
    encryptedApiKey: string;

    /** Last 4 characters of the cleartext API Key for display purposes. */
    @Column({ type: 'varchar', length: 8, default: '' })
    apiKeyLast4: string;

    /** Upstream model identifier, e.g. 'gemini-2.0-flash', 'gpt-4o-mini'. */
    @Column({ type: 'varchar', length: 160 })
    modelId: string;

    /**
     * API format hint.
     * - 'OPENAI' → OpenAI-compatible chat/completions endpoint
     * - 'GEMINI' → Gemini generateContent endpoint
     *
     * When empty / unset, the service infers from the modelId.
     */
    @Column({ type: 'varchar', length: 24, default: '' })
    apiFormat: string;

    /** Lower number = higher priority. Credentials at the same priority
     *  are balanced by smooth weighted round-robin. */
    @Column('int', { default: 100 })
    priority: number;

    /** Weight within the same priority group. */
    @Column('int', { default: 1 })
    weight: number;

    /** Current accumulated weight for smooth weighted round-robin. */
    @Column('int', { default: 0 })
    currentWeight: number;

    @Column({ type: 'varchar', length: 24, default: 'UNTESTED' })
    healthStatus: string;

    @Column({ type: 'varchar', length: 500, nullable: true })
    healthMessage: string | null;

    @Column({ type: Date, nullable: true })
    lastTestedAt: Date | null;

    @Column('int', { default: 0 })
    consecutiveFailures: number;

    @Column({ type: Date, nullable: true })
    cooldownUntil: Date | null;

    @Column({ type: Date, nullable: true })
    lastUsedAt: Date | null;

    @Column({ type: Date, nullable: true })
    archivedAt: Date | null;
}
