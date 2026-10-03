import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { CloudinaryService } from '../storage/cloudinary.service';
import { EmbeddingService } from '../rag/embedding.service';
import { VectorStoreService } from '../rag/vector-store.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { DocumentStatus } from '@ai-workforce/database';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import { DOCUMENT_INGESTION_QUEUE, DocumentIngestionJobData } from './ingestion.queue';

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
    @InjectQueue(DOCUMENT_INGESTION_QUEUE)
    private readonly ingestionQueue: Queue<DocumentIngestionJobData>,
  ) {}

  async createKnowledgeBase(organizationId: string, dto: CreateKnowledgeBaseDto) {
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

  async linkAgent(organizationId: string, kbId: string, agentId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId },
    });
    if (!kb) throw new NotFoundException('Knowledge base not found in this organization');

    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId },
    });
    if (!agent) throw new NotFoundException('Agent not found in this organization');

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
    if (!kb) throw new NotFoundException('Knowledge base not found in this organization');

    if (!file) throw new BadRequestException('No file uploaded');

    // Auto-link agent if agentId is provided
    if (agentId) {
      await this.linkAgent(organizationId, kbId, agentId);
    }

    // 1. Upload original file to Cloudinary
    let cloudResult;
    try {
      cloudResult = await this.cloudinaryService.uploadFile(file);
    } catch (err: any) {
      throw new InternalServerErrorException(`Cloudinary upload failed: ${err.message}`);
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
        throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
      }
    } catch (error: any) {
      throw new BadRequestException(`Failed to parse document: ${error.message}`);
    }

    if (!rawText || !rawText.trim()) {
      throw new BadRequestException('Uploaded document contains no readable text');
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
      message: 'Document uploaded. Background semantic chunking and embedding started.',
    };
  }   
  async searchKnowledge(
    organizationId: string,
    query: string,
    agentId?: string,
    limit = 5,
    threshold = 0.4,
  ) {
    const queryEmbedding = await this.embeddingService.generateQueryEmbedding(query);
    return this.vectorStoreService.similaritySearch(
      organizationId,
      queryEmbedding,
      limit,
      threshold,
      agentId,
    );
  }
}