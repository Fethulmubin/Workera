import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CloudinaryService } from '../storage/cloudinary.service';
import { EmbeddingService } from '../rag/embedding.service';
import { VectorStoreService } from '../rag/vector-store.service';
import { chunkText } from '../rag/text-splitter';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { DocumentStatus } from '@ai-workforce/database';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
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
) {
  const kb = await this.prisma.knowledgeBase.findFirst({
    where: { id: kbId, organizationId },
  });
  if (!kb) throw new NotFoundException('Knowledge base not found in this organization');

  if (!file) throw new BadRequestException('No file uploaded');

  // 1. Upload original file to Cloudinary
  let cloudResult;
  try {
    cloudResult = await this.cloudinaryService.uploadFile(file);
  } catch (err: any) {
    throw new Interna
}
