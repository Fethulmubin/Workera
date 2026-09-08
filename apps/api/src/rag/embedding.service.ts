import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
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
    let model =
      this.configService.get<string>('OPENROUTER_EMBED_MODEL') || 'baai/bge-base-en-v1.5';
    if (model.includes('nemotron') || model.includes('2048')) {
      model = 'baai/bge-base-en-v1.5';
    }
    this.openRouterModel = model;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    // 1. Try OpenRouter if configured
    if (this.openRouterApiKey) {
      try {
        return await this.generateOpenRouterBatch(texts);
      } catch (err: any) {
        this.logger.warn(`OpenRouter batch embedding failed, trying fallback: ${err.message}`);
      }
    }

    // 2. Fallback to Gemini if configured
    if (this.genAI) {
      try {
        return await this.generateGeminiBatch(texts);
      } catch (err: any) {
        this.logger.error(`Gemini document embedding failed: ${err.message}`);
        throw new InternalServerErrorException(`Embedding generation failed: ${err.message}`);
      }
    }

    throw new InternalServerErrorException(
      'No valid embedding provider configured. Set OPENROUTER_API_KEY or GEMINI_API_KEY in .env',
    );
  }

  async generateQueryEmbedding(query: string): Promise<number[]> {
    // 1. Try OpenRouter if configured
    if (this.openRouterApiKey) {
      try {
        const results = await this.generateOpenRouterBatch([query]);
        return results[0];
      } catch (err: any) {
        this.logger.warn(`OpenRouter query embedding failed, trying fallback: ${err.message}`);
      }
    }

    // 2. Fallback to Gemini if configured
    if (this.genAI) {
      try {
        const model = this.genAI.getGenerativeModel({ model: this.geminiModel });
        const response = await model.embedContent({
          content: { parts: [{ text: query }], role: 'user' },
          taskType: TaskType.RETRIEVAL_QUERY,
        });
        return response.embedding.values;
      } catch (err: any) {
        throw new InternalServerErrorException(`Query embedding failed: ${err.message}`);
      }
    }

    throw new InternalServerErrorException(
      'No valid embedding provider configured. Set OPENROUTER_API_KEY or GEMINI_API_KEY in .env',
    );
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
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid response structure from OpenRouter embedding API');
    }

    // Sort by index if returned out of order
    return data.data
      .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
      .map((item: any) => item.embedding);
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