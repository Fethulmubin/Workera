import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  generateText,
  streamText,
  Output,
  type LanguageModel,
  type ModelMessage,
} from 'ai';
import type { ZodType } from 'zod';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TextGenerationOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ObjectGenerationOptions<T> {
  schema: ZodType<T>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  schemaName?: string;
  schemaDescription?: string;
}

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly provider?: ReturnType<typeof createOpenRouter>;
  private readonly defaultModel: string;
  private readonly apiKey?: string;
  private readonly baseURL: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') || undefined;
    this.baseURL =
      this.configService.get<string>('OPENROUTER_BASE_URL') ||
      'https://openrouter.ai/api/v1';
    this.defaultModel =
      this.configService.get<string>('WORKERA_MODEL') ||
      'meta-llama/llama-3.3-70b-instruct:free';

    if (this.apiKey) {
      this.provider = createOpenRouter({
        apiKey: this.apiKey,
        baseURL: this.baseURL,
        headers: {
          'HTTP-Referer': 'https://ai-workforce.local',
          'X-Title': 'Workera AI Workforce',
        },
      });
    } else {
      this.logger.warn(
        'OPENROUTER_API_KEY is not configured. AIService calls will fail until it is provided.',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.provider && this.apiKey);
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  getBaseURL(): string {
    return this.baseURL;
  }

  private getModel(modelOverride?: string): LanguageModel {
    if (!this.provider) {
      throw new InternalServerErrorException(
        'OPENROUTER_API_KEY is not configured in environment',
      );
    }

    const modelName = modelOverride || this.defaultModel;
    if (!modelName) {
      throw new InternalServerErrorException(
        'WORKERA_MODEL is not configured in environment',
      );
    }

    return this.provider(modelName);
  }

  private mapMessages(messages: ChatMessage[]): ModelMessage[] {
    return messages.map((m) => {
      if (m.role === 'system') {
        return { role: 'system', content: m.content };
      }
      if (m.role === 'user') {
        return { role: 'user', content: m.content };
      }
      return { role: 'assistant', content: m.content };
    });
  }

  async generateText(
    messages: ChatMessage[],
    options?: TextGenerationOptions,
  ): Promise<string> {
    const model = this.getModel(options?.model);

    try {
      const result = await generateText({
        model,
        messages: this.mapMessages(messages),
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
      });

      return result.text.trim();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `AI text generation error: ${errorMessage}`,
        errorStack,
      );
      throw new InternalServerErrorException(
        `AI generation failed: ${errorMessage}`,
      );
    }
  }

  async streamText(
    messages: ChatMessage[],
    options?: TextGenerationOptions,
  ): Promise<AsyncIterable<string>> {
    const model = this.getModel(options?.model);

    try {
      const result = streamText({
        model,
        messages: this.mapMessages(messages),
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
      });

      return await Promise.resolve(result.textStream);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `AI stream generation error: ${errorMessage}`,
        errorStack,
      );
      throw new InternalServerErrorException(
        `AI stream generation failed: ${errorMessage}`,
      );
    }
  }

  async generateObject<T>(
    messages: ChatMessage[],
    options: ObjectGenerationOptions<T>,
  ): Promise<T> {
    const model = this.getModel(options?.model);

    try {
      const result = await generateText({
        model,
        messages: this.mapMessages(messages),
        output: Output.object({
          schema: options.schema,
          name: options.schemaName,
          description: options.schemaDescription,
        }),
        temperature: options?.temperature ?? 0.1,
        maxOutputTokens: options?.maxTokens,
      });

      return result.output as T;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `AI structured object generation error: ${errorMessage}`,
        errorStack,
      );
      throw new InternalServerErrorException(
        `AI structured generation failed: ${errorMessage}`,
      );
    }
  }
}
