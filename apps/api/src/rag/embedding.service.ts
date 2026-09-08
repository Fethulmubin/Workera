import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

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
    this.openRouterModel = 'baai/bge-base-en-v1.5';
  }

  private async generateGeminiBatch(texts: string[]): Promise<number[][]> {
    if (!this.genAI) throw new Error('Gemini AI not initialized');
    const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
    const results: number[][] = [];

    for (const text of texts) {
      const response = await model.embedContent({
        content: { parts: [{ text }], role: 'user' },
        taskType: TaskType.RETRIEVAL_DOCUMENT,
      });
      results.push(response.embedding.values);
    }

    return results;
  }
}
