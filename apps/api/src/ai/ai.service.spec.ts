import { ConfigService } from '@nestjs/config';
import { AIService } from './ai.service';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, streamText, Output } from 'ai';
import { z } from 'zod';

jest.mock('@openrouter/ai-sdk-provider');
jest.mock('ai');

describe('AIService', () => {
  let service: AIService;
  let mockConfigService: any;
  let mockProvider: jest.Mock;
  let mockModel: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockModel = { modelId: 'mock-model' };
    mockProvider = jest.fn().mockReturnValue(mockModel);
    (createOpenRouter as unknown as jest.Mock).mockReturnValue(mockProvider);

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'OPENROUTER_API_KEY') return 'test-openrouter-key';
        if (key === 'OPENROUTER_BASE_URL')
          return 'https://openrouter.ai/api/v1';
        if (key === 'WORKERA_MODEL')
          return 'meta-llama/llama-3.3-70b-instruct:free';
        return null;
      }),
    };

    service = new AIService(mockConfigService as ConfigService);
  });

  it('initializes correctly with OpenRouter provider and configuration', () => {
    expect(service.isConfigured()).toBe(true);
    expect(service.getDefaultModel()).toBe(
      'meta-llama/llama-3.3-70b-instruct:free',
    );
    expect(service.getBaseURL()).toBe('https://openrouter.ai/api/v1');

    expect(createOpenRouter).toHaveBeenCalledWith({
      apiKey: 'test-openrouter-key',
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'HTTP-Referer': 'https://ai-workforce.local',
        'X-Title': 'Workera AI Workforce',
      },
    });
  });

  it('reads custom model and baseURL from ConfigService', () => {
    const customConfig = {
      get: jest.fn((key: string) => {
        if (key === 'OPENROUTER_API_KEY') return 'custom-key';
        if (key === 'OPENROUTER_BASE_URL')
          return 'https://custom.openrouter.ai/v1';
        if (key === 'WORKERA_MODEL') return 'deepseek/deepseek-chat:free';
        return null;
      }),
    };
    const customService = new AIService(
      customConfig as unknown as ConfigService,
    );
    expect(customService.getDefaultModel()).toBe('deepseek/deepseek-chat:free');
    expect(customService.getBaseURL()).toBe('https://custom.openrouter.ai/v1');
  });

  it('generates text successfully using AI SDK generateText', async () => {
    (generateText as unknown as jest.Mock).mockResolvedValue({
      text: 'Hello, this is a response from AI SDK.',
    });

    const messages = [
      { role: 'system' as const, content: 'You are helpful.' },
      { role: 'user' as const, content: 'Hello!' },
    ];

    const result = await service.generateText(messages);

    expect(result).toBe('Hello, this is a response from AI SDK.');
    expect(mockProvider).toHaveBeenCalledWith(
      'meta-llama/llama-3.3-70b-instruct:free',
    );
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        instructions: 'You are helpful.',
        messages: [
          { role: 'user', content: 'Hello!' },
        ],
        temperature: 0.7,
      }),
    );
  });

  it('allows model override and custom temperature in generateText', async () => {
    (generateText as unknown as jest.Mock).mockResolvedValue({
      text: 'Custom model response',
    });

    const messages = [{ role: 'user' as const, content: 'Hi' }];
    const result = await service.generateText(messages, {
      model: 'openai/gpt-4o-mini',
      temperature: 0.2,
      maxTokens: 500,
    });

    expect(result).toBe('Custom model response');
    expect(mockProvider).toHaveBeenCalledWith('openai/gpt-4o-mini');
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        temperature: 0.2,
        maxOutputTokens: 500,
      }),
    );
  });

  it('streams text tokens correctly using AI SDK streamText', async () => {
    async function* fakeTextStream() {
      yield 'Hello';
      yield ' ';
      yield 'world!';
    }

    (streamText as unknown as jest.Mock).mockReturnValue({
      textStream: fakeTextStream(),
    });

    const messages = [{ role: 'user' as const, content: 'Hi stream' }];
    const stream = await service.streamText(messages);

    const tokens: string[] = [];
    for await (const token of stream) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['Hello', ' ', 'world!']);
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        messages: [{ role: 'user', content: 'Hi stream' }],
        temperature: 0.7,
      }),
    );
  });

  it('generates structured object correctly using AI SDK generateText with Output.object and Zod schema', async () => {
    const testSchema = z.object({
      selectedAgentId: z.string(),
      confidence: z.number(),
      reason: z.string(),
    });

    const expectedObject = {
      selectedAgentId: 'agent-123',
      confidence: 0.95,
      reason: 'Best match',
    };

    (generateText as unknown as jest.Mock).mockResolvedValue({
      output: expectedObject,
    });

    const messages = [{ role: 'user' as const, content: 'Route this' }];
    const result = await service.generateObject(messages, {
      schema: testSchema,
      schemaName: 'RoutingDecision',
      temperature: 0.1,
    });

    expect(result).toEqual(expectedObject);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        output: expect.objectContaining({
          schema: testSchema,
          name: 'RoutingDecision',
        }),
        temperature: 0.1,
      }),
    );
  });

  it('throws an error if OPENROUTER_API_KEY is not configured', async () => {
    const unconfiguredService = new AIService({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);

    expect(unconfiguredService.isConfigured()).toBe(false);

    await expect(
      unconfiguredService.generateText([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('OPENROUTER_API_KEY is not configured in environment');

    await expect(
      unconfiguredService.streamText([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('OPENROUTER_API_KEY is not configured in environment');

    await expect(
      unconfiguredService.generateObject([{ role: 'user', content: 'Hi' }], {
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toThrow('OPENROUTER_API_KEY is not configured in environment');
  });
});
