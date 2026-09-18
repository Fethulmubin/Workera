import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { VectorStoreService } from '../rag/vector-store.service';
import { EmbeddingService } from '../rag/embedding.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';

@Injectable()
export class AgentExecutionService {
  private readonly logger = new Logger(AgentExecutionService.name);
  private genAI: GoogleGenerativeAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly embeddingService: EmbeddingService,
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
    // 1. Fetch Agent configuration
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId },
      include: { knowledgeBases: true },
    });
    if (!agent)
      throw new NotFoundException('Agent not found in this organization');

    // 2. Ensure Conversation exists
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

    // Save User Message
    await this.prisma.message.create({
      data: {
        conversationId: activeConversationId,
        role: 'user',
        content: userMessage,
      },
    });

    // 3. Dynamic RAG: Retrieve context from linked Knowledge Bases
    this.logger.log(`Retrieving RAG context for Agent: ${agentId}`);
    const queryEmbedding =
      await this.embeddingService.generateQueryEmbedding(userMessage);
    const retrievedChunks = await this.vectorStoreService.similaritySearch(
      organizationId,
      queryEmbedding,
      5,
      0.4,
      agentId,
    );

    // 4. Construct System Prompt with Context & Citations
    const contextText = retrievedChunks
      .map(
        (chunk, idx) =>
          `[Source ${idx + 1} - ${chunk.documentTitle}]\n${chunk.content}`,
      )
      .join('\n\n');

    const systemPrompt = `
${agent.systemPrompt || 'You are a helpful AI assistant.'}

---
CONTEXT FROM KNOWLEDGE BASE:
${contextText || 'No relevant knowledge base documents found.'}
---

INSTRUCTIONS:
- Answer the user's query using the provided context when relevant.
- Cite your sources when using facts from the knowledge base using [Source X].
`;

    
  }
}
