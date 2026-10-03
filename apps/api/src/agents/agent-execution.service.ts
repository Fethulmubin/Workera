import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { VectorStoreService } from "../rag/vector-store.service";
import { EmbeddingService } from "../rag/embedding.service";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { ConfigService } from "@nestjs/config";
import { Observable, Subject } from "rxjs";

export interface ChatIdentity {
  userId?: string;
  anonymousSessionId?: string;
}

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
    const apiKey = this.configService.get<string>("GEMINI_API_KEY") || "";
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  private resolveIdentity(
    identityOrUserId: string | ChatIdentity,
  ): ChatIdentity {
    if (typeof identityOrUserId === "string") {
      return { userId: identityOrUserId };
    }
    return identityOrUserId;
  }

  private async findOwnedConversation(
    conversationId: string,
    organizationId: string,
    agentId: string,
    identity: ChatIdentity,
  ) {
    if (!identity.userId && !identity.anonymousSessionId) {
      throw new BadRequestException("User or anonymous session identity is required");
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
        agentId,
        ...(identity.userId
          ? { userId: identity.userId }
          : { anonymousSessionId: identity.anonymousSessionId }),
      },
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    return conversation;
  }

  buildSystemPrompt(
    agentPrompt: string | null | undefined,
    retrievedChunks: Array<{ documentTitle: string; content: string }>,
  ): string {
    const contextText = retrievedChunks
      .map(
        (chunk, idx) =>
          `[Source ${idx + 1} - ${chunk.documentTitle}]\n${chunk.content}`,
      )
      .join("\n\n");

    return `
${agentPrompt?.trim() || "You are a helpful AI assistant."}

---
CONTEXT FROM KNOWLEDGE BASE:
${contextText || "No relevant knowledge base documents found."}
---

INSTRUCTIONS:
- Answer the user's query using the provided context when relevant.
- Cite your sources when using facts from the knowledge base using [Source X].
`.trim();
  }

  async executeChat(
    organizationId: string,
    agentId: string,
    userMessage: string,
    conversationId: string | undefined,
    identityOrUserId: string | ChatIdentity,
  ) {
    const identity = this.resolveIdentity(identityOrUserId);

    // 1. Fetch Agent configuration
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId },
      include: { knowledgeBases: true },
    });
    if (!agent) {
      throw new NotFoundException("Agent not found in this organization");
    }

    if (agent.isActive === false) {
      throw new BadRequestException(
        "Agent is inactive and cannot execute conversations",
      );
    }

    if (identity.anonymousSessionId && !agent.isPublic) {
      throw new ForbiddenException(
        "This agent is private and cannot be accessed anonymously",
      );
    }

    // 2. Ensure Conversation exists and validate ownership
    let activeConversationId = conversationId;
    if (!activeConversationId) {
      const conv = await this.prisma.conversation.create({
        data: {
          organizationId,
          agentId,
          ...(identity.userId
            ? { userId: identity.userId }
            : { anonymousSessionId: identity.anonymousSessionId }),
          title: userMessage.slice(0, 40),
        },
      });
      activeConversationId = conv.id;
    } else {
      await this.findOwnedConversation(
        activeConversationId,
        organizationId,
        agentId,
        identity,
      );
    }

    // Save User Message
    await this.prisma.message.create({
      data: {
        conversationId: activeConversationId,
        role: "user",
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
    const systemPrompt = this.buildSystemPrompt(
      agent.systemPrompt,
      retrievedChunks,
    );

    // 5. Fetch previous message history
    const history = await this.prisma.message.findMany({
      where: { conversationId: activeConversationId },
      orderBy: { createdAt: "asc" },
      take: 10,
    });

    const contents = history.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const modelName =
      this.configService.get<string>("GEMINI_MODEL") || "gemini-3.6-flash";
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
        role: "assistant",
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
    conversationId: string | undefined,
    identityOrUserId: string | ChatIdentity,
  ): Observable<{ data: string }> {
    const stream$ = new Subject<{ data: string }>();
    const identity = this.resolveIdentity(identityOrUserId);

    (async () => {
      try {
        // 1. Fetch Agent configuration
        const agent = await this.prisma.agent.findFirst({
          where: { id: agentId, organizationId },
          include: { knowledgeBases: true },
        });
        if (!agent) {
          throw new NotFoundException("Agent not found in this organization");
        }

        if (agent.isActive === false) {
          throw new BadRequestException(
            "Agent is inactive and cannot execute conversations",
          );
        }

        if (identity.anonymousSessionId && !agent.isPublic) {
          throw new ForbiddenException(
            "This agent is private and cannot be accessed anonymously",
          );
        }

        // 2. Ensure Conversation exists and validate ownership
        let activeConversationId = conversationId;
        if (!activeConversationId) {
          const conv = await this.prisma.conversation.create({
            data: {
              organizationId,
              agentId,
              ...(identity.userId
                ? { userId: identity.userId }
                : { anonymousSessionId: identity.anonymousSessionId }),
              title: userMessage.slice(0, 40),
            },
          });
          activeConversationId = conv.id;
        } else {
          await this.findOwnedConversation(
            activeConversationId,
            organizationId,
            agentId,
            identity,
          );
        }

        // Emit conversation ID metadata right away
        stream$.next({
          data: JSON.stringify({
            type: "metadata",
            conversationId: activeConversationId,
          }),
        });

        // Save User Message
        await this.prisma.message.create({
          data: {
            conversationId: activeConversationId,
            role: "user",
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
          data: JSON.stringify({ type: "citations", citations }),
        });

        // 4. Construct System Prompt
        const systemPrompt = this.buildSystemPrompt(
          agent.systemPrompt,
          retrievedChunks,
        );

        // 5. Fetch message history for context continuity
        const history = await this.prisma.message.findMany({
          where: { conversationId: activeConversationId },
          orderBy: { createdAt: "asc" },
          take: 10,
        });

        const contents = history.map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        }));

        // 6. Gemini Stream Execution
        const modelName =
          this.configService.get<string>("GEMINI_MODEL") || "gemini-3.6-flash";
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const chat = model.startChat({
          history: contents.slice(0, -1),
        });

        const resultStream = await chat.sendMessageStream(
          `${systemPrompt}\n\nUser: ${userMessage}`,
        );

        let fullContent = "";
        for await (const chunk of resultStream.stream) {
          const textChunk = chunk.text();
          fullContent += textChunk;
          stream$.next({
            data: JSON.stringify({ type: "token", content: textChunk }),
          });
        }

        // 7. Save Assistant Message after stream completes
        const savedAssistantMsg = await this.prisma.message.create({
          data: {
            conversationId: activeConversationId,
            role: "assistant",
            content: fullContent,
            citations,
          },
        });

        // Emit completion event
        stream$.next({
          data: JSON.stringify({
            type: "done",
            messageId: savedAssistantMsg.id,
          }),
        });

        stream$.complete();
      } catch (err: any) {
        this.logger.error(`Stream execution error: ${err.message}`, err.stack);
        stream$.next({
          data: JSON.stringify({ type: "error", error: err.message }),
        });
        stream$.complete();
      }
    })();

    return stream$.asObservable();
  }
}
