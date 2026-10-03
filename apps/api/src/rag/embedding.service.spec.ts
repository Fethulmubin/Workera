import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';
import OpenAI from 'openai';

jest.mock('openai');

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  let mockConfigService: any;
  let mockEmbeddingsCreate: jest.Mock;
  const mock768Vector = new Array(768).fill(0.05);

  beforeEach(() => {
    jest.clearAllMocks();

    mockEmbeddingsCreate = jest.fn();
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      embeddings: {
        create: mockEmbeddingsCreate,
      },
    }));

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'OPENROUTER_API_KEY') return 'test-openrouter-key';
        if (key === 'OPENROUTER_EMBEDDING_MODEL') return 'google/text-embedding-004';
        if (key === 'CLOUDFLARE_ACCOUNT_ID') return 'test-cf-account';
        if (key === 'CLOUDFLARE_API_TOKEN') return 'test-cf-token';
        if (key === 'CLOUDFLARE_EMBEDDING_MODEL') return '@cf/baai/bge-base-en-v1.5';
        if (key === 'EMBEDDING_DIMENSIONS') return 768;
        return null;
      }),
    };

    service = new EmbeddingService(mockConfigService as ConfigService);
  });

  describe('Primary Provider (OpenRouter via OpenAI SDK)', () => {
    it('initializes with expected 768 dimensions', () => {
      expect(service.getExpectedDimensions()).toBe(768);
      expect(service.isCloudflareConfigured()).toBe(true);
    });

    it('generates batch embeddings successfully with 768 dimensions', async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [
          { index: 0, embedding: [...mock768Vector] },
          { index: 1, embedding: [...mock768Vector] },
        ],
      });

      const result = await service.generateEmbeddings(['doc 1', 'doc 2']);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(768);
      expect(result[1]).toHaveLength(768);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'google/text-embedding-004',
        input: ['doc 1', 'doc 2'],
      });
    });

    it('generates query embedding successfully with 768 dimensions', async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ index: 0, embedding: [...mock768Vector] }],
      });

      const result = await service.generateQueryEmbedding('search query');

      expect(result).toHaveLength(768);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'google/text-embedding-004',
        input: ['search query'],
      });
    });

    it('rejects primary embeddings with invalid dimensions', async () => {
      const invalidVector = new Array(512).fill(0.1); // 512 != 768
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ index: 0, embedding: invalidVector }],
      });

      // Primary fails dimension check -> attempts fallback -> fallback not mocked here, should fail
      // To test dimension rejection without fallback:
      const noFallbackConfig = {
        get: jest.fn((key: string) => {
          if (key === 'OPENROUTER_API_KEY') return 'test-key';
          if (key === 'OPENROUTER_EMBEDDING_MODEL') return 'google/text-embedding-004';
          return null;
        }),
      };
      const noFallbackService = new EmbeddingService(noFallbackConfig as any);

      await expect(
        noFallbackService.generateEmbeddings(['test']),
      ).rejects.toThrow('Embedding validation failed for primary (OpenRouter): expected 768 dimensions, but received 512');
    });
  });

  describe('Fallback Provider (Cloudflare Workers AI)', () => {
    it('invokes Cloudflare Workers AI fallback when primary OpenRouter fails', async () => {
      mockEmbeddingsCreate.mockRejectedValue(new Error('OpenRouter 500 error'));

      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            shape: [1, 768],
            data: [[...mock768Vector]],
          },
        }),
      } as Response);

      const result = await service.generateEmbeddings(['fallback text']);

      expect(mockEmbeddingsCreate).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/test-cf-account/ai/run/@cf/baai/bge-base-en-v1.5',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-cf-token',
          }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(768);

      mockFetch.mockRestore();
    });

    it('rejects fallback embeddings with invalid dimensions', async () => {
      mockEmbeddingsCreate.mockRejectedValue(new Error('OpenRouter error'));

      const invalidVector = new Array(1024).fill(0.2); // 1024 != 768
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            shape: [1, 1024],
            data: [invalidVector],
          },
        }),
      } as Response);

      await expect(
        service.generateEmbeddings(['invalid cf dimension']),
      ).rejects.toThrow('expected 768 dimensions, but received 1024');

      mockFetch.mockRestore();
    });

    it('throws clean exception when primary fails and Cloudflare fallback is not configured', async () => {
      const noFallbackConfig = {
        get: jest.fn((key: string) => {
          if (key === 'OPENROUTER_API_KEY') return 'test-key';
          return null;
        }),
      };
      const noFallbackService = new EmbeddingService(noFallbackConfig as any);
      mockEmbeddingsCreate.mockRejectedValue(new Error('Network timeout'));

      await expect(
        noFallbackService.generateEmbeddings(['test']),
      ).rejects.toThrow('Primary embedding failed (Network timeout) and Cloudflare Workers AI fallback is not configured.');
    });
  });
});
