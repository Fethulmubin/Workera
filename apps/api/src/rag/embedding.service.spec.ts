/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';

describe('EmbeddingService (Google Gemini API Direct)', () => {
  let service: EmbeddingService;
  let mockConfigService: { get: jest.Mock };
  const mock768Vector: number[] = Array.from({ length: 768 }, () => 0.05);

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'GEMINI_API_KEY') return 'test-gemini-key';
        if (key === 'GEMINI_EMBEDDING_MODEL') return 'gemini-embedding-001';
        if (key === 'EMBEDDING_DIMENSIONS') return 768;
        return null;
      }),
    };

    service = new EmbeddingService(
      mockConfigService as unknown as ConfigService,
    );
  });

  describe('Configuration & Initialization', () => {
    it('initializes with gemini-embedding-001 and expected 768 dimensions', () => {
      expect(service.getExpectedDimensions()).toBe(768);
      expect(service.getModel()).toBe('gemini-embedding-001');
    });

    it('returns empty array when no texts provided', async () => {
      const result = await service.generateEmbeddings([]);
      expect(result).toEqual([]);
    });

    it('throws error when GEMINI_API_KEY is not configured', async () => {
      const unconfiguredConfig = {
        get: jest.fn(() => null),
      };
      const unconfiguredService = new EmbeddingService(
        unconfiguredConfig as unknown as ConfigService,
      );

      await expect(
        unconfiguredService.generateEmbeddings(['test']),
      ).rejects.toThrow('GEMINI_API_KEY is not configured in environment');

      await expect(
        unconfiguredService.generateQueryEmbedding('test query'),
      ).rejects.toThrow('GEMINI_API_KEY is not configured in environment');
    });
  });

  describe('Batch Document Embeddings (batchEmbedContents)', () => {
    it('calls Google Gemini batchEmbedContents directly with outputDimensionality 768', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => {
          await Promise.resolve();
          return {
            embeddings: [
              { values: [...mock768Vector] },
              { values: [...mock768Vector] },
            ],
          };
        },
      } as Response);

      const result = await service.generateEmbeddings(['doc 1', 'doc 2']);

      expect(mockFetch).toHaveBeenCalled();
      const calledUrl = mockFetch.mock.calls[0]?.[0];
      const calledInit = mockFetch.mock.calls[0]?.[1];

      expect(calledUrl).toContain(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents',
      );
      expect(calledUrl).toContain('key=test-gemini-key');

      const body = JSON.parse(calledInit?.body as string);
      expect(body.requests).toHaveLength(2);
      expect(body.requests[0]).toEqual({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: 'doc 1' }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768,
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(768);
      expect(result[1]).toHaveLength(768);

      mockFetch.mockRestore();
    });

    it('rejects batch embeddings if dimension mismatch occurs', async () => {
      const invalidVector: number[] = Array.from({ length: 512 }, () => 0.1);
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => {
          await Promise.resolve();
          return {
            embeddings: [{ values: invalidVector }],
          };
        },
      } as Response);

      await expect(
        service.generateEmbeddings(['document mismatch']),
      ).rejects.toThrow(
        'Embedding dimension mismatch at index 0: expected 768, received 512',
      );

      mockFetch.mockRestore();
    });

    it('throws when Gemini API returns an error response', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => {
          await Promise.resolve();
          return 'Bad Request: invalid argument';
        },
      } as Response);

      await expect(
        service.generateEmbeddings(['document error']),
      ).rejects.toThrow('Gemini batch embedding failed: HTTP 400');

      mockFetch.mockRestore();
    });
  });

  describe('Query Embedding (embedContent)', () => {
    it('calls Google Gemini embedContent directly with taskType RETRIEVAL_QUERY and 768 dimensions', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => {
          await Promise.resolve();
          return {
            embedding: {
              values: [...mock768Vector],
            },
          };
        },
      } as Response);

      const result = await service.generateQueryEmbedding('Search query');

      expect(mockFetch).toHaveBeenCalled();
      const calledUrl = mockFetch.mock.calls[0]?.[0];
      const calledInit = mockFetch.mock.calls[0]?.[1];

      expect(calledUrl).toContain(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
      );
      expect(calledUrl).toContain('key=test-gemini-key');

      const body = JSON.parse(calledInit?.body as string);
      expect(body).toEqual({
        content: { parts: [{ text: 'Search query' }] },
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 768,
      });

      expect(result).toHaveLength(768);

      mockFetch.mockRestore();
    });

    it('rejects query embedding if dimension mismatch occurs', async () => {
      const invalidVector: number[] = Array.from({ length: 1024 }, () => 0.2);
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => {
          await Promise.resolve();
          return {
            embedding: {
              values: invalidVector,
            },
          };
        },
      } as Response);

      await expect(
        service.generateQueryEmbedding('query mismatch'),
      ).rejects.toThrow(
        'Embedding dimension mismatch: expected 768, received 1024',
      );

      mockFetch.mockRestore();
    });
  });
});
