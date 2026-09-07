import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly genAI?: GoogleGenerativeAI;
  private readonly openRouterApiKey?: string;
  private readonly openRouterModel: string;
  private readonly geminiModel = 'text-embedding-004';

  constructor(private readonly configService: ConfigService) {
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (geminiKey) {
      this.genAI = new GoogleGenerativeAI(geminiKey);
    }

    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    let model =
      this.configService.get<string>('OPENROUTER_EMBED_MODEL') || 'baai/bge-base-en-v1.5';
    if (model.includes('nemotron') || model.includes('2048')) {
      model = 'baai/bge-base-en-v1.5';
    }
    this.openRouterModel = model;
  }
}
