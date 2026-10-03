/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => {},
  Processor: () => () => {},
  WorkerHost: class {},
}));
jest.mock('bullmq', () => ({
  Queue: class {},
}));

import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationRole, DocumentStatus } from '@ai-workforce/database';
import { RolesGuard } from '../auth/roles.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { IngestionProcessor } from './ingestion.processor';
import { PrismaService } from '../database/prisma.service';
import { CloudinaryService } from '../storage/cloudinary.service';
import { EmbeddingService } from '../rag/embedding.service';
import { VectorStoreService } from '../rag/vector-store.service';

describe('PHASE 3 — Knowledge Base & Document Lifecycle', () => {
  let reflector: Reflector;
  let rolesGuard: RolesGuard;
  let mockPrisma: any;
  let mockCloudinary: any;
  let mockEmbeddingService: any;
  let mockVectorStore: any;
  let mockQueue: any;
  let kbService: KnowledgeBaseService;
  let processor: IngestionProcessor;

  const orgA = 'org-A';
  const orgB = 'org-B';
  const kbIdA = 'kb-100';
  const docIdA = 'doc-200';
  const agentIdA = 'agent-300';
  const agentIdB = 'agent-other-org';

  beforeEach(() => {
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);

    mockPrisma = {
      knowledgeBase: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
      },
      document: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
      },
      documentChunk: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      agent: {
        findFirst: jest.fn(),
      },
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };

    mockCloudinary = {
      uploadFile: jest.fn(),
      deleteFile: jest.fn().mockResolvedValue({ result: 'ok' }),
    };

    mockEmbeddingService = {
      generateEmbeddings: jest.fn(),
      generateQueryEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    };

    mockVectorStore = {
      storeChunkWithEmbedding: jest.fn().mockResolvedValue(undefined),
      similaritySearch: jest.fn(),
    };

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    kbService = new KnowledgeBaseService(
      mockPrisma as unknown as PrismaService,
      mockCloudinary as unknown as CloudinaryService,
      mockEmbeddingService as unknown as EmbeddingService,
      mockVectorStore as unknown as VectorStoreService,
      mockQueue,
    );

    processor = new IngestionProcessor(
      mockPrisma as unknown as PrismaService,
      mockEmbeddingService as unknown as EmbeddingService,
      mockVectorStore as unknown as VectorStoreService,
    );
  });

  const createMockExecutionContext = (
    handler: Function,
    controllerClass: Function,
    tenantContext?: { role: OrganizationRole; organizationId: string },
  ): ExecutionContext => {
    return {
      getHandler: () => handler,
      getClass: () => controllerClass,
      switchToHttp: () => ({
        getRequest: () => ({
          tenant: tenantContext,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  describe('1. Knowledge Base CRUD & RBAC', () => {
    it('GET /knowledge-bases/:id allows MEMBER and returns KB for own organization', async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue({
        id: kbIdA,
        organizationId: orgA,
        name: 'Engineering Docs',
        _count: { documents: 3, agents: 1 },
      });

      const result = await kbService.getKnowledgeBaseById(orgA, kbIdA);
      expect(result.id).toBe(kbIdA);
      expect(mockPrisma.knowledgeBase.findFirst).toHaveBeenCalledWith({
        where: { id: kbIdA, organizationId: orgA },
        include: { _count: { select: { documents: true, agents: true } } },
      });
    });

    it('GET /knowledge-bases/:id throws NotFoundException if KB belongs to another organization', async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue(null);

      await expect(kbService.getKnowledgeBaseById(orgB, kbIdA)).rejects.toThrow(
        new NotFoundException('Knowledge base not found in this organization'),
      );
    });

    it('PATCH /knowledge-bases/:id requires OWNER or ADMIN via RBAC decorator', () => {
      const roles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        KnowledgeBaseController.prototype.update,
      );
      expect(roles).toEqual([OrganizationRole.OWNER, OrganizationRole.ADMIN]);

      const memberCtx = createMockExecutionContext(
        KnowledgeBaseController.prototype.update,
        KnowledgeBaseController,
        { role: OrganizationRole.MEMBER, organizationId: orgA },
      );
      expect(() => rolesGuard.canActivate(memberCtx)).toThrow(
        ForbiddenException,
      );

      const adminCtx = createMockExecutionContext(
        KnowledgeBaseController.prototype.update,
        KnowledgeBaseController,
        { role: OrganizationRole.ADMIN, organizationId: orgA },
      );
      expect(rolesGuard.canActivate(adminCtx)).toBe(true);
    });

    it('DELETE /knowledge-bases/:id requires OWNER or ADMIN via RBAC decorator', () => {
      const roles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        KnowledgeBaseController.prototype.remove,
      );
      expect(roles).toEqual([OrganizationRole.OWNER, OrganizationRole.ADMIN]);

      const memberCtx = createMockExecutionContext(
        KnowledgeBaseController.prototype.remove,
        KnowledgeBaseController,
        { role: OrganizationRole.MEMBER, organizationId: orgA },
      );
      expect(() => rolesGuard.canActivate(memberCtx)).toThrow(
        ForbiddenException,
      );

      const adminCtx = createMockExecutionContext(
        KnowledgeBaseController.prototype.remove,
        KnowledgeBaseController,
        { role: OrganizationRole.ADMIN, organizationId: orgA },
      );
      expect(rolesGuard.canActivate(adminCtx)).toBe(true);
    });

    it('DELETE /knowledge-bases/:id cleans up Cloudinary files and cascades DB deletion', async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue({
        id: kbIdA,
        organizationId: orgA,
        documents: [
          { id: 'doc-1', cloudinaryPublicId: 'cloud-1' },
          { id: 'doc-2', cloudinaryPublicId: null },
        ],
      });
      mockPrisma.knowledgeBase.delete.mockResolvedValue({ id: kbIdA });

      const result = await kbService.deleteKnowledgeBase(orgA, kbIdA);
      expect(mockCloudinary.deleteFile).toHaveBeenCalledWith('cloud-1');
      expect(mockPrisma.knowledgeBase.delete).toHaveBeenCalledWith({
        where: { id: kbIdA },
      });
      expect(result.message).toBe('Knowledge base deleted successfully');
    });
  });

  describe('2. Document Management API', () => {
    it('listDocuments returns scoped documents for own organization', async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue({
        id: kbIdA,
        organizationId: orgA,
      });
      mockPrisma.document.findMany.mockResolvedValue([
        {
          id: docIdA,
          title: 'architecture.pdf',
          fileType: 'application/pdf',
          fileSize: 1024,
          status: DocumentStatus.READY,
          errorMessage: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const docs = await kbService.listDocuments(orgA, kbIdA);
      expect(docs.length).toBe(1);
      expect(docs[0].id).toBe(docIdA);
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith({
        where: { knowledgeBaseId: kbIdA },
        select: {
          id: true,
          title: true,
          fileType: true,
          fileSize: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('listDocuments throws 404 if KB belongs to another organization', async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue(null);

      await expect(kbService.listDocuments(orgB, kbIdA)).rejects.toThrow(
        new NotFoundException('Knowledge base not found in this organization'),
      );
    });

    it('getDocumentById returns document details for own KB and 404 for wrong org/KB', async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue({
        id: kbIdA,
        organizationId: orgA,
      });
      mockPrisma.document.findFirst.mockResolvedValue({
        id: docIdA,
        title: 'handbook.pdf',
        fileType: 'application/pdf',
        fileSize: 2048,
        status: DocumentStatus.READY,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const doc = await kbService.getDocumentById(orgA, kbIdA, docIdA);
      expect(doc.id).toBe(docIdA);

      // Document not found in KB
      mockPrisma.document.findFirst.mockResolvedValue(null);
      await expect(
        kbService.getDocumentById(orgA, kbIdA, 'wrong-doc'),
      ).rejects.toThrow(
        new NotFoundException('Document not found in this knowledge base'),
      );
    });

    it('getDocumentStatus returns only status and error information', async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue({
        id: kbIdA,
        organizationId: orgA,
      });
      mockPrisma.document.findFirst.mockResolvedValue({
        id: docIdA,
        status: DocumentStatus.PROCESSING,
        errorMessage: null,
      });

      const status = await kbService.getDocumentStatus(orgA, kbIdA, docIdA);
      expect(status).toEqual({
        id: docIdA,
        status: DocumentStatus.PROCESSING,
        errorMessage: null,
      });
    });

    it('deleteDocument requires OWNER or ADMIN', () => {
      const roles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        KnowledgeBaseController.prototype.deleteDocument,
      );
      expect(roles).toEqual([OrganizationRole.OWNER, OrganizationRole.ADMIN]);

      const memberCtx = createMockExecutionContext(
        KnowledgeBaseController.prototype.deleteDocument,
        KnowledgeBaseController,
        { role: OrganizationRole.MEMBER, organizationId: orgA },
      );
      expect(() => rolesGuard.canActivate(memberCtx)).toThrow(
        ForbiddenException,
      );

      const adminCtx = createMockExecutionContext(
        KnowledgeBaseController.prototype.deleteDocument,
        KnowledgeBaseController,
        { role: OrganizationRole.ADMIN, organizationId: orgA },
      );
      expect(rolesGuard.canActivate(adminCtx)).toBe(true);
    });

    it('deleteDocument cleans Cloudinary file and removes document from database', async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue({
        id: kbIdA,
        organizationId: orgA,
      });
      mockPrisma.document.findFirst.mockResolvedValue({
        id: docIdA,
        knowledgeBaseId: kbIdA,
        cloudinaryPublicId: 'cloud-doc-123',
      });
      mockPrisma.document.delete.mockResolvedValue({ id: docIdA });

      const result = await kbService.deleteDocument(orgA, kbIdA, docIdA);
      expect(mockCloudinary.deleteFile).toHaveBeenCalledWith('cloud-doc-123');
      expect(mockPrisma.document.delete).toHaveBeenCalledWith({
        where: { id: docIdA },
      });
      expect(result.message).toBe('Document deleted successfully');
    });
  });

  describe('3. Ingestion Reliability & Idempotency', () => {
    it('skips cleanly if document was deleted after job was queued', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(null);

      await processor.process({
        id: 'job-1',
        data: { documentId: 'deleted-doc', rawText: 'Some text' },
      } as any);

      expect(mockPrisma.document.update).not.toHaveBeenCalled();
    });

    it('successful processing transitions PENDING -> PROCESSING -> READY and clears existing chunks for idempotency', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: docIdA,
        status: DocumentStatus.PENDING,
      });
      mockEmbeddingService.generateEmbeddings.mockResolvedValue([
        [0.1, 0.2, 0.3],
      ]);

      await processor.process({
        id: 'job-1',
        data: {
          documentId: docIdA,
          rawText:
            'Hello world. This is a complete sentence that forms a chunk.',
        },
      } as any);

      // Verify status transitions
      expect(mockPrisma.document.update).toHaveBeenNthCalledWith(1, {
        where: { id: docIdA },
        data: { status: DocumentStatus.PROCESSING },
      });

      // Verify idempotency: chunks cleared before storing
      expect(mockPrisma.documentChunk.deleteMany).toHaveBeenCalledWith({
        where: { documentId: docIdA },
      });

      // Verify chunks stored
      expect(mockVectorStore.storeChunkWithEmbedding).toHaveBeenCalled();

      // Verify status set to READY
      expect(mockPrisma.document.update).toHaveBeenNthCalledWith(2, {
        where: { id: docIdA },
        data: { status: DocumentStatus.READY },
      });
    });

    it('sets status to FAILED when document produces empty chunks', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: docIdA,
        status: DocumentStatus.PROCESSING,
      });

      // Pass text with only whitespace/non-text
      await expect(
        processor.process({
          id: 'job-empty',
          data: { documentId: docIdA, rawText: '   ' },
        } as any),
      ).rejects.toThrow();

      expect(mockPrisma.document.update).toHaveBeenCalledWith({
        where: { id: docIdA },
        data: {
          status: DocumentStatus.FAILED,
          errorMessage: expect.stringContaining('No valid chunks generated'),
        },
      });
    });

    it('sets status to FAILED when embedding count does not match chunk count', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: docIdA,
        status: DocumentStatus.PROCESSING,
      });
      // Return empty embeddings array
      mockEmbeddingService.generateEmbeddings.mockResolvedValue([]);

      await expect(
        processor.process({
          id: 'job-mismatch',
          data: {
            documentId: docIdA,
            rawText: 'Sentence number one. Sentence number two.',
          },
        } as any),
      ).rejects.toThrow();

      expect(mockPrisma.document.update).toHaveBeenCalledWith({
        where: { id: docIdA },
        data: {
          status: DocumentStatus.FAILED,
          errorMessage: expect.stringContaining(
            'does not match embedding count',
          ),
        },
      });
    });
  });

  describe('4. RAG Tenant & Agent Isolation', () => {
    let vectorStoreService: VectorStoreService;

    beforeEach(() => {
      vectorStoreService = new VectorStoreService(
        mockPrisma as unknown as PrismaService,
      );
    });

    it('searchKnowledge throws NotFoundException when agentId belongs to another organization', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);

      await expect(
        kbService.searchKnowledge(orgA, 'query terms', agentIdB),
      ).rejects.toThrow(
        new NotFoundException('Agent not found in this organization'),
      );
    });

    it('similaritySearch returns empty list if agentId does not belong to organization', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);

      const results = await vectorStoreService.similaritySearch(
        orgA,
        [0.1, 0.2],
        5,
        0.4,
        agentIdB,
      );

      expect(results).toEqual([]);
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('similaritySearch passes organizationId to match_document_chunks', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
      });
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        {
          id: 'chunk-1',
          document_id: docIdA,
          document_title: 'Test Doc',
          content: 'Relevant content',
          similarity: 0.85,
        },
      ]);

      const results = await vectorStoreService.similaritySearch(
        orgA,
        [0.1, 0.2],
        5,
        0.4,
        agentIdA,
      );

      expect(results.length).toBe(1);
      expect(results[0].similarity).toBe(0.85);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM match_document_chunks'),
        '[0.1,0.2]',
        0.4,
        5,
        orgA,
        agentIdA,
      );
    });
  });
});
