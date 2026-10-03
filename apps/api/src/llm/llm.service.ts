import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'text' | 'json_object' };
}

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  private readonly client?: OpenAI;
  private readonly defaultModel: string;
  private readonly apiKey?: string;
  private readonly baseURL: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY') || undefined;
    this.baseURL =
      this.configService.get<string>('OPENROUTER_BASE_URL') ||
      'https://openrouter.ai/api/v1';
    this.defaultModel =
      this.configService.get<string>('WORKERA_MODEL') ||
      'meta-llama/llama-3.3-70b-instruct:free';

    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseURL,
        defaultHeaders: {
          'HTTP-Referer': 'https://ai-workforce.local',
          'X-Title': 'Workera AI Workforce',
        },
      });
    } else {
      this.logger.warn(
        'OPENROUTER_API_KEY is not configured. LLMService calls will fail until it is provided.',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.client && this.apiKey);
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  getBaseURL(): string {
    return this.baseURL;
  }

  async generateCompletion(
    messages: ChatMessage[],
    options?: CompletionOptions,
  ): Promise<string> {
    if (!this.client) {
      throw new InternalServerErrorException(
        'OPENROUTER_API_KEY is not configured in environment',
      );
    }

    const model = options?.model || this.defaultModel;
    if (!model) {
      throw new InternalServerErrorException(
        'WORKERA_MODEL is not configured in environment',
      );
    }

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
        response_format: options?.responseFormat,
      });

      return response.choices[0]?.message?.content?.trim() || '';
    } catch (err: any) {
      this.logger.error(`OpenRouter generation error: ${err.message}`, err.stack);
      throw new InternalServerErrorException(`LLM generation failed: ${err.message}`);
    }
  }

  async streamCompletion(
    messages: ChatMessage[],
    options?: CompletionOptions,
  ): Promise<AsyncIterable<string>> {
    if (!this.client) {
      throw new InternalServerErrorException(
        'OPENROUTER_API_KEY is not configured in environment',
      );
    }

    const model = options?.model || this.defaultModel;
    if (!model) {
      throw new InternalServerErrorException(
        'WORKERA_MODEL is not configured in environment',
      );
    }

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
        stream: true,
      });

      async function* tokenGenerator() {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            yield delta;
          }
        }
      }

      return tokenGenerator();
    } catch (err: any) {
      this.logger.error(`OpenRouter stream generation error: ${err.message}`, err.stack);
      throw new InternalServerErrorException(
        `LLM stream generation failed: ${err.message}`,
      );
    }
  }
}
