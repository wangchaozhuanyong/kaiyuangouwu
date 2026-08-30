import { Controller, Get, Res } from '@nestjs/common';

import { ImageGenerationReliabilityService } from './image-generation-reliability.service';

@Controller('image-generation/health')
export class ImageGenerationHealthController {
    constructor(private readonly reliability: ImageGenerationReliabilityService) {}

    @Get()
    async health(@Res() response: any): Promise<void> {
        const snapshot = await this.reliability.healthSnapshot();
        response.status(['DOWN', 'DEGRADED'].includes(snapshot.status) ? 503 : 200).json(snapshot);
    }
}
