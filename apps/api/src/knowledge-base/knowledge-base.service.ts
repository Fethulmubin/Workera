import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { CloudinaryService } from '../storage/cloudinary.service';
import { EmbeddingService } from '../rag/embedding.service';
import { VectorStoreService } from '../rag/vector-store.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';
import { DocumentStatus } from '@ai-workforce/database';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import {
  DOCUMENT_INGESTION_QUEUE,
  DocumentIngestionJobData,
} from './ingestion.queue';

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
    @InjectQueue(DOCUMENT_INGESTION_QUEUE)
    private readonly ingestionQueue: Queue<DocumentIngestionJobData>,
  ) {}

  async createKnowledgeBase(
    organizationId: string,
    dto: CreateKnowledgeBaseDto,
  ) {
    return this.prisma.knowledgeBase.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description,
      },
    });
  }

  async listKnowledgeBases(organizationId: string) {
    return this.prisma.knowledgeBase.findMany({
      where: { organizationId },
      include: {
        _count: {
          select: { documents: true, agents: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getKnowledgeBaseById(organizationId: string, kbId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
      include: {
        _count: {
          select: { documents: true, agents: true },
        },
      },
    });
    if (!kb) {
      throw new NotFoundException(
        'Knowledge base not found in this organization',
      );
    }
    return kb;
  }

  async updateKnowledgeBase(
    organizationId: string,
    kbId: string,
    dto: UpdateKnowledgeBaseDto,
  ) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
    });
    if (!kb) {
      throw new NotFoundException(
        'Knowledge base not found in this organization',
      );
    }

    return this.prisma.knowledgeBase.update({
      where: { id: kbId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });
  }

  async deleteKnowledgeBase(organizationId: string, kbId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
      include: { documents: true },
    });
    if (!kb) {
      throw new NotFoundException(
        'Knowledge base not found in this organization',
      );
    }

    for (const doc of kb.documents) {
      if (doc.cloudinaryPublicId) {
        try {
          await this.cloudinaryService.deleteFile(doc.cloudinaryPublicId);
        } catch (err: any) {
          this.logger.warn(
            `Failed to delete Cloudinary file for document ${doc.id}: ${err.message}`,
          );
        }
      }
    }

    await this.prisma.knowledgeBase.delete({
      where: { id: kbId },
    });

    return { message: 'Knowledge base deleted successfully' };
  }

    async unlinkAgent(organizationId: string, kbId: string, agentId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
    });
    if (!kb)
      throw new NotFoundException(
        "Knowledge base not found in this organization",
      );

    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId },
    });
    if (!agent)
      throw new NotFoundException("Agent not found in this organization");

    const link = await this.prisma.agentKnowledgeBase.findUnique({
      where: {
        agentId_knowledgeBaseId: {
          agentId,
          knowledgeBaseId: kbId,
        },
      },
    });

    if (!link) {
      throw new NotFoundException(
        "Link between Agent and Knowledge Base not found",
      );
    }

    await this.prisma.agentKnowledgeBase.delete({
      where: {
        agentId_knowledgeBaseId: {
          agentId,
          knowledgeBaseId: kbId,
        },
      },
    });

    return { message: "Agent unlinked from knowledge base successfully" };
  }

  async linkAgent(organizationId: string, kbId: string, agentId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
    });
    if (!kb)
      throw new NotFoundException(
        'Knowledge base not found in this organization',
      );

    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId },
    });
    if (!agent)
      throw new NotFoundException('Agent not found in this organization');

    return this.prisma.agentKnowledgeBase.upsert({
      where: {
        agentId_knowledgeBaseId: {
          agentId,
          knowledgeBaseId: kbId,
        },
      },
      create: {
        agentId,
        knowledgeBaseId: kbId,
      },
      update: {},
    });
  }

  async uploadAndProcessDocument(
    organizationId: string,
    kbId: string,
    file: Express.Multer.File,
    agentId?: string,
  ) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
    });
    if (!kb)
      throw new NotFoundException(
        'Knowledge base not found in this organization',
      );

    if (!file || file.size === 0)
      throw new BadRequestException('No file uploaded or file is empty');

    // Auto-link agent if agentId is provided
    if (agentId) {
      await this.linkAgent(organizationId, kbId, agentId);
    }

    // 1. Upload original file to Cloudinary
    let cloudResult;
    try {
      cloudResult = await this.cloudinaryService.uploadFile(file);
    } catch (err: any) {
      throw new InternalServerErrorException(
        `Cloudinary upload failed: ${err.message}`,
      );
    }

    // 2. Extract text (PDF, DOCX, or TXT)
    let rawText = '';
    try {
      if (file.mimetype === 'application/pdf') {
        const parser = new PDFParse({ data: file.buffer });
        const result = await parser.getText();
        rawText = result.text;
        await parser.destroy();
      } else if (
        file.mimetype ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.originalname.endsWith('.docx')
      ) {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        rawText = result.value;
      } else if (file.mimetype === 'text/plain') {
        rawText = file.buffer.toString('utf-8');
      } else {
        throw new BadRequestException(
          `Unsupported file type: ${file.mimetype}`,
        );
      }
    } catch (error: any) {
      throw new BadRequestException(
        `Failed to parse document: ${error.message}`,
      );
    }

    if (!rawText || !rawText.trim()) {
      throw new BadRequestException(
        'Uploaded document contains no readable text',
      );
    }

    // 3. Create Document record with PENDING status
    const doc = await this.prisma.document.create({
      data: {
        knowledgeBaseId: kbId,
        title: file.originalname,
        fileUrl: cloudResult.secure_url,
        cloudinaryPublicId: cloudResult.public_id,
        fileType: file.mimetype,
        fileSize: file.size,
        status: DocumentStatus.PENDING,
      },
    });

    // 4. Dispatch async processing job to BullMQ Redis Queue
    await this.ingestionQueue.add('ingest', {
      documentId: doc.id,
      rawText,
    });

    // 5. Return HTTP 202 Accepted response immediately
    return {
      id: doc.id,
      title: doc.title,
      status: doc.status,
      fileUrl: doc.fileUrl,
      message:
        'Document uploaded. Background semantic chunking and embedding started.',
    };
  }

  async listDocuments(organizationId: string, kbId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
    });
    if (!kb) {
      throw new NotFoundException(
        'Knowledge base not found in this organization',
      );
    }

    return this.prisma.document.findMany({
      where: { knowledgeBaseId: kbId },
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
  }

  async getDocumentById(
    organizationId: string,
    kbId: string,
    documentId: string,
  ) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
    });
    if (!kb) {
      throw new NotFoundException(
        'Knowledge base not found in this organization',
      );
    }

    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        knowledgeBaseId: kbId,
      },
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
    });
    if (!doc) {
      throw new NotFoundException('Document not found in this knowledge base');
    }

    return doc;
  }

  async getDocumentStatus(
    organizationId: string,
    kbId: string,
    documentId: string,
  ) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
    });
    if (!kb) {
      throw new NotFoundException(
        'Knowledge base not found in this organization',
      );
    }

    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        knowledgeBaseId: kbId,
      },
      select: {
        id: true,
        status: true,
        errorMessage: true,
      },
    });
    if (!doc) {
      throw new NotFoundException('Document not found in this knowledge base');
    }

    return doc;
  }

  async deleteDocument(
    organizationId: string,
    kbId: string,
    documentId: string,
  ) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
    });
    if (!kb) {
      throw new NotFoundException(
        'Knowledge base not found in this organization',
      );
    }

    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        knowledgeBaseId: kbId,
      },
    });
    if (!doc) {
      throw new NotFoundException('Document not found in this knowledge base');
    }

    if (doc.cloudinaryPublicId) {
      try {
        await this.cloudinaryService.deleteFile(doc.cloudinaryPublicId);
      } catch (err: any) {
        this.logger.warn(
          `Failed to delete Cloudinary file for document ${doc.id}: ${err.message}`,
        );
      }
    }

    await this.prisma.document.delete({
      where: { id: documentId },
    });

    return { message: 'Document deleted successfully' };
  }

  async searchKnowledge(
    organizationId: string,
    query: string,
    agentId?: string,
    limit = 5,
    threshold = 0.4,
  ) {
    if (agentId) {
      const agent = await this.prisma.agent.findFirst({
        where: { id: agentId, organizationId },
      });
      if (!agent) {
        throw new NotFoundException('Agent not found in this organization');
      }
    }

    const queryEmbedding =
      await this.embeddingService.generateQueryEmbedding(query);
    return this.vectorStoreService.similaritySearch(
      organizationId,
      queryEmbedding,
      limit,
      threshold,
      agentId,
    );
  }
}
