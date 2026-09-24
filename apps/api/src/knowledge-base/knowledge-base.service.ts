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
    throw new InternalServerErrorException(`Cloudinary upload failed: ${err.message}`);
  }

  // 2. Create Document record with PROCESSING status
  const doc = await this.prisma.document.create({
    data: {
      knowledgeBaseId: kbId,
      title: file.originalname,
      fileUrl: cloudResult.secure_url,
      cloudinaryPublicId: cloudResult.public_id,
      fileType: file.mimetype,
      fileSize: file.size,
      status: DocumentStatus.PROCESSING,
    },
  });

  // 3. Extract text (FIXED SECTION)
  let rawText = '';
  try {
    if (file.mimetype === 'application/pdf') {
      // Correct usage for pdf-parse v2
      const parser = new PDFParse({ data: file.buffer });
      const result = await parser.getText(); 
      rawText = result.text; // Extract the text property
      await parser.destroy(); // Clean up resources
    } else {
      rawText = file.buffer.toString('utf-8');
    }
  } catch (error: any) {
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { status: DocumentStatus.FAILED, errorMessage: `PDF Parse Error: ${error.message}` },
    });
    throw new BadRequestException(`Failed to parse PDF: ${error.message}`);
  }

  if (!rawText || !rawText.trim()) {
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { status: DocumentStatus.FAILED, errorMessage: 'File contains no readable text' },
    });
    throw new BadRequestException('Uploaded document contains no readable text');
  }

  // 4. Chunk text
  const chunks = chunkText(rawText);

  // 5. Generate embeddings via Gemini & insert into pgvector
  try {
    const textsToEmbed = chunks.map((c) => c.content);
    const embeddings = await this.embeddingService.generateEmbeddings(textsToEmbed);

    for (let i = 0; i < chunks.length; i++) {
      await this.vectorStoreService.storeChunkWithEmbedding(
        doc.id,
        chunks[i].content,
        chunks[i].chunkIndex,
        embeddings[i],
      );
    }

    return await this.prisma.document.update({
      where: { id: doc.id },
      data: { status: DocumentStatus.READY },
    });
  } catch (error: any) {
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { status: DocumentStatus.FAILED, errorMessage: error.message },
    });
    throw new InternalServerErrorException(`Embedding generation failed: ${error.message}`);
  }
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