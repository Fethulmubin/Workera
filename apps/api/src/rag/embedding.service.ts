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

  private async generateOpenRouterBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.openRouterModel,
        input: texts,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.data
      .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
      .map((item: any) => item.embedding);
  }
}
