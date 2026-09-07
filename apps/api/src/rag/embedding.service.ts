import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly openRouterApiKey?: string;
  private readonly openRouterModel: string;

  constructor(private readonly configService: ConfigService) {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    this.openRouterModel =
      this.configService.get<string>('OPENROUTER_EMBED_MODEL') || 'baai/bge-base-en-v1.5';
  }
}
