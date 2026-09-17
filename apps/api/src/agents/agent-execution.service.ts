import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AgentExecutionService {
  private readonly logger = new Logger(AgentExecutionService.name);
  private genAI: GoogleGenerativeAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async executeChat(
    organizationId: string,
    agentId: string,
    userMessage: string,
    conversationId?: string,
  ) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId },
      include: { knowledgeBases: true },
    });
    if (!agent) throw new NotFoundException('Agent not found in this organization');

    let activeConversationId = conversationId;
    if (!activeConversationId) {
      const conv = await this.prisma.conversation.create({
        data: {
          organizationId,
          agentId,
          title: userMessage.slice(0, 40),
        },
      });
      activeConversationId = conv.id;
    }

    await this.prisma.message.create({
      data: {
        conversationId: activeConversationId,
        role: 'user',
        content: userMessage,
      },
    });
  }
}
