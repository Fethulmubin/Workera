import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface GeminiEmbedContentResponse {
  embedding?: {
    values?: number[];
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface GeminiBatchEmbedResponse {
  embeddings?: Array<{
    values?: number[];
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly normalizedModel: string;
  private readonly expectedDimensions: number;
  private readonly baseUrl =
    'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || undefined;

    this.model =
      this.configService.get<string>('GEMINI_EMBEDDING_MODEL') ||
      'gemini-embedding-001';

    this.normalizedModel = this.model.replace(/^models\//, '');

    const configuredDims = this.configService.get<number | string>(
      'EMBEDDING_DIMENSIONS',
    );
    this.expectedDimensions = configuredDims ? Number(configuredDims) : 768;

    if (!this.apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY is not configured. EmbeddingService calls will fail until it is provided.',
      );
    }
  }

  getExpectedDimensions(): number {
    return this.expectedDimensions;
  }

  getModel(): string {
    return this.model;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured in environment',
      );
    }

    const BATCH_SIZE = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batchTexts = texts.slice(i, i + BATCH_SIZE);
      const batchResults = await this.executeBatchEmbed(batchTexts);
      allEmbeddings.push(...batchResults);
    }

    return allEmbeddings;
  }

  async generateQueryEmbedding(query: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured in environment',
      );
    }

    const url = `${this.baseUrl}/${this.normalizedModel}:embedContent?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text: query }] },
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: this.expectedDimensions,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Gemini query embedding API error (${response.status}): ${errorText}`,
        );
        throw new InternalServerErrorException(
          `Gemini query embedding failed: HTTP ${response.status}`,
        );
      }

      const data = (await response.json()) as GeminiEmbedContentResponse;

      if (data.error) {
        this.logger.error(
          `Gemini query embedding error: ${data.error.message}`,
        );
        throw new InternalServerErrorException(
          `Gemini query embedding failed: ${data.error.message}`,
        );
      }

      const values = data.embedding?.values;
      if (!values || !Array.isArray(values)) {
        throw new InternalServerErrorException(
          'Invalid response from Gemini embedding API: missing embedding values',
        );
      }

      if (values.length !== this.expectedDimensions) {
        throw new InternalServerErrorException(
          `Embedding dimension mismatch: expected ${this.expectedDimensions}, received ${values.length}`,
        );
      }

      return values;
    } catch (err: unknown) {
      if (err instanceof InternalServerErrorException) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Gemini query embedding error: ${errorMessage}`);
      throw new InternalServerErrorException(
        `Gemini query embedding failed: ${errorMessage}`,
      );
    }
  }

  private async executeBatchEmbed(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/${this.normalizedModel}:batchEmbedContents?key=${this.apiKey}`;

    const requests = texts.map((text) => ({
      model: `models/${this.normalizedModel}`,
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: this.expectedDimensions,
    }));

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Gemini batch embedding API error (${response.status}): ${errorText}`,
        );
        throw new InternalServerErrorException(
          `Gemini batch embedding failed: HTTP ${response.status}`,
        );
      }

      const data = (await response.json()) as GeminiBatchEmbedResponse;

      if (data.error) {
        this.logger.error(
          `Gemini batch embedding error: ${data.error.message}`,
        );
        throw new InternalServerErrorException(
          `Gemini batch embedding failed: ${data.error.message}`,
        );
      }

      const embeddings = data.embeddings;
      if (!embeddings || !Array.isArray(embeddings)) {
        throw new InternalServerErrorException(
          'Invalid response from Gemini batch embedding API: missing embeddings array',
        );
      }

      if (embeddings.length !== texts.length) {
        throw new InternalServerErrorException(
          `Gemini batch embedding count mismatch: requested ${texts.length}, received ${embeddings.length}`,
        );
      }

      const results: number[][] = [];
      for (let i = 0; i < embeddings.length; i++) {
        const values = embeddings[i]?.values;
        if (!values || !Array.isArray(values)) {
          throw new InternalServerErrorException(
            `Missing embedding values at index ${i}`,
          );
        }
        if (values.length !== this.expectedDimensions) {
          throw new InternalServerErrorException(
            `Embedding dimension mismatch at index ${i}: expected ${this.expectedDimensions}, received ${values.length}`,
          );
        }
        results.push(values);
      }

      return results;
    } catch (err: unknown) {
      if (err instanceof InternalServerErrorException) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Gemini batch embedding error: ${errorMessage}`);
      throw new InternalServerErrorException(
        `Gemini batch embedding failed: ${errorMessage}`,
      );
    }
  }
}
