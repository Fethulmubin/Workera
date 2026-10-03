import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly openAiClient?: OpenAI;
  private readonly openRouterApiKey?: string;
  private readonly openRouterEmbeddingModel: string;
  private readonly cloudflareAccountId?: string;
  private readonly cloudflareApiToken?: string;
  private readonly cloudflareEmbeddingModel: string;
  private readonly expectedDimensions: number;

  constructor(private readonly configService: ConfigService) {
    this.openRouterApiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') || undefined;
    const openRouterBaseUrl =
      this.configService.get<string>('OPENROUTER_BASE_URL') ||
      'https://openrouter.ai/api/v1';

    this.openRouterEmbeddingModel =
      this.configService.get<string>('OPENROUTER_EMBEDDING_MODEL') ||
      this.configService.get<string>('OPENROUTER_EMBED_MODEL') ||
      'google/text-embedding-004';

    this.cloudflareAccountId =
      this.configService.get<string>('CLOUDFLARE_ACCOUNT_ID') || undefined;
    this.cloudflareApiToken =
      this.configService.get<string>('CLOUDFLARE_API_TOKEN') || undefined;
    this.cloudflareEmbeddingModel =
      this.configService.get<string>('CLOUDFLARE_EMBEDDING_MODEL') ||
      '@cf/baai/bge-base-en-v1.5';

    const configuredDims = this.configService.get<number | string>(
      'EMBEDDING_DIMENSIONS',
    );
    this.expectedDimensions = configuredDims ? Number(configuredDims) : 768;

    if (this.openRouterApiKey) {
      this.openAiClient = new OpenAI({
        apiKey: this.openRouterApiKey,
        baseURL: openRouterBaseUrl,
        defaultHeaders: {
          'HTTP-Referer': 'https://ai-workforce.local',
          'X-Title': 'Workera AI Workforce',
        },
      });
    } else {
      this.logger.warn(
        'OPENROUTER_API_KEY not set. Primary embedding provider will be unavailable.',
      );
    }
  }

  getExpectedDimensions(): number {
    return this.expectedDimensions;
  }

  isCloudflareConfigured(): boolean {
    return Boolean(this.cloudflareAccountId && this.cloudflareApiToken);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    let primaryError: Error | null = null;

    // 1. Try Primary: OpenRouter (Gemini embedding via OpenAI SDK)
    if (this.openAiClient) {
      try {
        const embeddings = await this.generateOpenRouterBatch(texts);
        this.validateDimensions(embeddings, 'primary (OpenRouter)');
        this.logger.debug(
          `Generated ${embeddings.length} embeddings via OpenRouter (${this.openRouterEmbeddingModel}) [${this.expectedDimensions}d]`,
        );
        return embeddings;
      } catch (err: any) {
        primaryError = err;
        this.logger.warn(
          `Primary OpenRouter embedding failed, trying fallback: ${err.message}`,
        );
      }
    } else {
      primaryError = new Error('OPENROUTER_API_KEY not configured');
    }

    // 2. Try Fallback: Cloudflare Workers AI (@cf/baai/bge-base-en-v1.5)
    if (this.isCloudflareConfigured()) {
      try {
        const embeddings = await this.generateCloudflareBatch(texts);
        this.validateDimensions(embeddings, 'fallback (Cloudflare Workers AI)');
        this.logger.log(
          `Generated ${embeddings.length} embeddings via Cloudflare fallback (${this.cloudflareEmbeddingModel}) [${this.expectedDimensions}d]`,
        );
        return embeddings;
      } catch (cfErr: any) {
        this.logger.error(
          `Cloudflare fallback embedding failed: ${cfErr.message}`,
        );
        throw new InternalServerErrorException(
          `All embedding providers failed. Primary: ${primaryError?.message}. Fallback: ${cfErr.message}`,
        );
      }
    }

    throw new InternalServerErrorException(
      `Primary embedding failed (${primaryError?.message}) and Cloudflare Workers AI fallback is not configured.`,
    );
  }

  async generateQueryEmbedding(query: string): Promise<number[]> {
    const embeddings = await this.generateEmbeddings([query]);
    if (!embeddings.length || !embeddings[0]) {
      throw new InternalServerErrorException(
        'Failed to generate query embedding: empty response',
      );
    }
    return embeddings[0];
  }

  private async generateOpenRouterBatch(texts: string[]): Promise<number[][]> {
    if (!this.openAiClient) {
      throw new Error('OpenAI client for OpenRouter not initialized');
    }

    const response = await this.openAiClient.embeddings.create({
      model: this.openRouterEmbeddingModel,
      input: texts,
    });

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Invalid response structure from OpenRouter embedding API');
    }

    return response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  private async generateCloudflareBatch(texts: string[]): Promise<number[][]> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.cloudflareAccountId}/ai/run/${this.cloudflareEmbeddingModel}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cloudflareApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: texts }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloudflare Workers AI API error (${response.status}): ${errorText}`,
      );
    }

    const json = await response.json();
    if (!json.success && json.errors && json.errors.length > 0) {
      const errMsgs = json.errors
        .map((e: any) => e.message || JSON.stringify(e))
        .join(', ');
      throw new Error(`Cloudflare Workers AI error: ${errMsgs}`);
    }

    const data = json.result?.data;
    if (!data || !Array.isArray(data)) {
      throw new Error(
        'Invalid response structure from Cloudflare Workers AI embedding API',
      );
    }

    if (Array.isArray(data[0])) {
      return data as number[][];
    } else if (typeof data[0] === 'number') {
      return [data as number[]];
    }

    throw new Error('Unexpected data format from Cloudflare Workers AI');
  }

  private validateDimensions(
    embeddings: number[][],
    providerLabel: string,
  ): void {
    for (let i = 0; i < embeddings.length; i++) {
      const emb = embeddings[i];
      if (!Array.isArray(emb) || emb.length !== this.expectedDimensions) {
        throw new Error(
          `Embedding validation failed for ${providerLabel}: expected ${this.expectedDimensions} dimensions, but received ${emb?.length ?? 0}`,
        );
      }
    }
  }
}