import { ConfigService } from '@nestjs/config';
import { LLMService } from './llm.service';
import OpenAI from 'openai';

jest.mock('openai');

describe('LLMService', () => {
  let service: LLMService;
  let mockConfigService: any;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCreate = jest.fn();
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    }));

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

    service = new LLMService(mockConfigService as ConfigService);
  });

  it('initializes correctly with OpenRouter configuration', () => {
    expect(service.isConfigured()).toBe(true);
    expect(service.getDefaultModel()).toBe(
      'meta-llama/llama-3.3-70b-instruct:free',
    );
    expect(service.getBaseURL()).toBe('https://openrouter.ai/api/v1');

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'test-openrouter-key',
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
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
    const customService = new LLMService(
      customConfig as unknown as ConfigService,
    );
    expect(customService.getDefaultModel()).toBe('deepseek/deepseek-chat:free');
    expect(customService.getBaseURL()).toBe('https://custom.openrouter.ai/v1');
  });

  it('generates chat completion successfully using configured model', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Hello, this is a response from OpenRouter.',
          },
        },
      ],
    });

    const messages = [
      { role: 'system' as const, content: 'You are helpful.' },
      { role: 'user' as const, content: 'Hello!' },
    ];

    const result = await service.generateCompletion(messages);

    expect(result).toBe('Hello, this is a response from OpenRouter.');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello!' },
        ],
        temperature: 0.7,
      }),
    );
  });

  it('allows model and options override in generateCompletion', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"answer": true}' } }],
    });

    const messages = [{ role: 'user' as const, content: 'Evaluate' }];
    const result = await service.generateCompletion(messages, {
      model: 'custom/special-model',
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    });

    expect(result).toBe('{"answer": true}');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom/special-model',
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    );
  });

  it('streams completion tokens correctly', async () => {
    async function* fakeStream() {
      await Promise.resolve();
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' ' } }] };
      yield { choices: [{ delta: { content: 'world!' } }] };
    }

    mockCreate.mockResolvedValue(fakeStream());

    const messages = [{ role: 'user' as const, content: 'Hi stream' }];
    const stream = await service.streamCompletion(messages);

    const tokens: string[] = [];
    for await (const token of stream) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['Hello', ' ', 'world!']);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        model: 'meta-llama/llama-3.3-70b-instruct:free',
      }),
    );
  });

  it('throws an error if OPENROUTER_API_KEY is not configured', async () => {
    const unconfiguredService = new LLMService({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);

    await expect(
      unconfiguredService.generateCompletion([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('OPENROUTER_API_KEY is not configured in environment');

    await expect(
      unconfiguredService.streamCompletion([{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('OPENROUTER_API_KEY is not configured in environment');
  });
});
