import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(private readonly prisma: PrismaService) {}

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
}
