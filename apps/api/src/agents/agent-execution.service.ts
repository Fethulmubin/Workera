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
    userId?: string,
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
          userId: userId || 'anonymous',
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

    // 5. Fetch previous message history
    const history = await this.prisma.message.findMany({
      where: { conversationId: activeConversationId },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    const contents = history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const modelName =
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-3.6-flash';
    const model = this.genAI.getGenerativeModel({ model: modelName });
    const chat = model.startChat({
      history: contents.slice(0, -1), // Exclude latest message added directly
    });

    const result = await chat.sendMessage(
      `${systemPrompt}\n\nUser: ${userMessage}`,
    );
    const responseText = result.response.text();

    // 7. Save Assistant Response with Citations Metadata
    const citations = retrievedChunks.map((c) => ({
      chunkId: c.id,
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      similarity: c.similarity,
    }));

    const savedAssistantMsg = await this.prisma.message.create({
      data: {
        conversationId: activeConversationId,
        role: 'assistant',
        content: responseText,
        citations,
      },
    });

    return {
      conversationId: activeConversationId,
      message: savedAssistantMsg,
      citations,
    };
  }

  executeChatStream(
    organizationId: string,
    agentId: string,
    userMessage: string,
    conversationId?: string,
    userId?: string,
  ): Observable<{ data: string }> {
    const stream$ = new Subject<{ data: string }>();

    (async () => {
      try {
        // 1. Fetch Agent configuration
        const agent = await this.prisma.agent.findFirst({
          where: { id: agentId, organizationId },
          include: { knowledgeBases: true },
        });
        if (!agent) {
          stream$.error(
            new NotFoundException('Agent not found in this organization'),
          );
          return;
        }

        // 2. Ensure Conversation exists
        let activeConversationId = conversationId;
        if (!activeConversationId) {
          const conv = await this.prisma.conversation.create({
            data: {
              organizationId,
              agentId,
              userId: userId || 'anonymous',
              title: userMessage.slice(0, 40),
            },
          });
          activeConversationId = conv.id;
        }

        // Emit conversation ID metadata right away
        stream$.next({
          data: JSON.stringify({
            type: 'metadata',
            conversationId: activeConversationId,
          }),
        });

        // Save User Message
        await this.prisma.message.create({
          data: {
            conversationId: activeConversationId,
            role: 'user',
            content: userMessage,
          },
        });

        // 3. Dynamic RAG: Context retrieval
        this.logger.log(`Retrieving RAG context for Agent Stream: ${agentId}`);
        const queryEmbedding =
          await this.embeddingService.generateQueryEmbedding(userMessage);
        const retrievedChunks = await this.vectorStoreService.similaritySearch(
          organizationId,
          queryEmbedding,
          5,
          0.4,
          agentId,
        );

        const citations = retrievedChunks.map((c) => ({
          chunkId: c.id,
          documentId: c.documentId,
          documentTitle: c.documentTitle,
          similarity: c.similarity,
        }));

        // Emit citations metadata
        stream$.next({
          data: JSON.stringify({ type: 'citations', citations }),
        });

        // 4. Construct System Prompt
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

        // 5. Fetch message history for context continuity
        const history = await this.prisma.message.findMany({
          where: { conversationId: activeConversationId },
          orderBy: { createdAt: 'asc' },
          take: 10,
        });

        const contents = history.map((msg) => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        }));

        // 6. Gemini Stream Execution
        const modelName =
          this.configService.get<string>('GEMINI_MODEL') || 'gemini-3.6-flash';
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const chat = model.startChat({
          history: contents.slice(0, -1),
        });

        const resultStream = await chat.sendMessageStream(
          `${systemPrompt}\n\nUser: ${userMessage}`,
        );

        let fullContent = '';
        for await (const chunk of resultStream.stream) {
          const textChunk = chunk.text();
          fullContent += textChunk;
          stream$.next({
            data: JSON.stringify({ type: 'token', content: textChunk }),
          });
        }

        // 7. Save Assistant Message after stream completes
        const savedAssistantMsg = await this.prisma.message.create({
          data: {
            conversationId: activeConversationId,
            role: 'assistant',
            content: fullContent,
            citations,
          },
        });

        // Emit completion event
        stream$.next({
          data: JSON.stringify({
            type: 'done',
            messageId: savedAssistantMsg.id,
          }),
        });

        stream$.complete();
      } catch (err: any) {
        this.logger.error(`Stream execution error: ${err.message}`, err.stack);
        stream$.next({
          data: JSON.stringify({ type: 'error', error: err.message }),
        });
        stream$.complete();
      }
    })();

    return stream$.asObservable();
  }
}