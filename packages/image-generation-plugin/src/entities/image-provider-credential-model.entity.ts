import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { ImageModelConfig } from './image-model-config.entity';
import { ImageProviderCredential } from './image-provider-credential.entity';

@Entity({ name: 'image_provider_credential_model' })
@Index('IDX_image_provider_credential_model_unique', ['credentialId', 'modelConfigId'], { unique: true })
export class ImageProviderCredentialModel extends VendureEntity {
    constructor(input?: DeepPartial<ImageProviderCredentialModel>) {
        super(input);
    }

    @ManyToOne(() => ImageProviderCredential, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'credentialId', foreignKeyConstraintName: 'FK_image_provider_model_credential' })
    credential: ImageProviderCredential;

    @EntityId()
    credentialId: ID;

    @ManyToOne(() => ImageModelConfig, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'modelConfigId', foreignKeyConstraintName: 'FK_image_provider_model_model' })
    modelConfig: ImageModelConfig;

    @EntityId()
    modelConfigId: ID;
}
