import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { PrismaService } from '../database/prisma.service';
import { AgentExecutionService } from './agent-execution.service';
import {
  RoutingDecision,
  SupervisedChatResponse,
  SupervisorChatDto,
} from './dto/supervisor-chat.dto';
import { AgentType, type Conversation } from '@ai-workforce/database';
import { AIService } from '../ai/ai.service';
import { z } from 'zod';

const routingDecisionSchema = z.object({
  selectedAgentId: z.string().describe('ID of chosen agent'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence score between 0.0 and 1.0'),
  reason: z.string().describe('Brief justification in one sentence'),
});

@Injectable()
export class AgentSupervisorService {
  private readonly logger = new Logger(AgentSupervisorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentExecutionService: AgentExecutionService,
    private readonly aiService: AIService,
  ) {}

  /**
   * Ensures an organization always has at least one active General Agent.
   */
  private async getOrCreateDefaultGeneralAgent(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    const orgName = org?.name || 'Company';

    this.logger.log(
      `Auto-provisioning default General Agent for organization: ${organizationId}`,
    );

    return this.prisma.agent.create({
      data: {
        organizationId,
        name: `${orgName} Assistant`,
        type: AgentType.GENERAL,
        description:
          'Primary organization assistant for general inquiries, drafting, and workplace productivity.',
        systemPrompt: `You are the primary General Workplace Assistant for ${orgName}.
Assist employees and team members with workplace productivity, questions, drafting, and general support.`,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
      },
    });
  }

  /**
   * Route an incoming prompt to the most suitable agent in the organization.
   */
  async routeRequest(
    organizationId: string,
    userMessage: string,
    conversationId?: string,
    forceReRoute = false,
    userId?: string,
  ): Promise<RoutingDecision> {
    // 1. If conversation exists and re-routing is not forced, stick to the existing agent
    if (conversationId) {
      const existingConv = await this.prisma.conversation.findFirst({
        where: {
          id: conversationId,
          organizationId,
          ...(userId ? { userId } : {}),
        },
        include: { agent: true },
      });

      if (!existingConv && userId) {
        throw new NotFoundException('Conversation not found');
      }

      if (
        existingConv &&
        existingConv.agent &&
        existingConv.agent.isActive !== false &&
        !forceReRoute
      ) {
        return {
          selectedAgentId: existingConv.agentId,
          agentName: existingConv.agent.name,
          confidence: 1.0,
          reason: 'Continuing existing conversation with assigned agent.',
        };
      }
    }

    // 2. Fetch all active agents for the organization
    let availableAgents = await this.prisma.agent.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
      },
    });

    if (availableAgents.length === 0) {
      const defaultAgent =
        await this.getOrCreateDefaultGeneralAgent(organizationId);
      availableAgents = [defaultAgent];
    }

    // 3. Short-circuit if only 1 agent exists
    if (availableAgents.length === 1) {
      const single = availableAgents[0];
      return {
        selectedAgentId: single.id,
        agentName: single.name,
        confidence: 1.0,
        reason: 'Only one active agent available in this organization.',
      };
    }

    // 4. Classify agent via AI
    return this.classifyAgent(availableAgents, userMessage);
  }

  /**
   * Execute chat by automatically routing to the chosen agent.
   */
  async executeSupervisedChat(
    organizationId: string,
    dto: SupervisorChatDto,
    userId: string,
  ): Promise<SupervisedChatResponse> {
    let effectiveConversationId = dto.conversationId;
    let existingConv: Conversation | null = null;

    if (effectiveConversationId) {
      existingConv = await this.prisma.conversation.findFirst({
        where: {
          id: effectiveConversationId,
          organizationId,
          userId,
        },
      });

      if (!existingConv) {
        throw new NotFoundException('Conversation not found');
      }
    }

    const routing = await this.routeRequest(
      organizationId,
      dto.message,
      effectiveConversationId,
      dto.forceReRoute,
      userId,
    );

    this.logger.log(
      `Supervisor routed query to "${routing.agentName}" (${routing.selectedAgentId}). Reason: ${routing.reason}`,
    );

    if (existingConv && existingConv.agentId !== routing.selectedAgentId) {
      this.logger.log(
        `Conversation ${effectiveConversationId} belongs to agent ${existingConv.agentId}, but supervisor selected ${routing.selectedAgentId}. Starting new conversation.`,
      );
      effectiveConversationId = undefined;
    }

    const executionResult = await this.agentExecutionService.executeChat(
      organizationId,
      routing.selectedAgentId,
      dto.message,
      effectiveConversationId,
      userId,
    );

    return {
      routing,
      conversationId: executionResult.conversationId,
      message: executionResult.message,
      citations: executionResult.citations,
    };
  }

  /**
   * Execute chat streaming via SSE with an initial routing event.
   */
  executeSupervisedChatStream(
    organizationId: string,
    dto: SupervisorChatDto,
    userId: string,
  ): Observable<{ data: string }> {
    const stream$ = new Subject<{ data: string }>();

    (async () => {
      try {
        let effectiveConversationId = dto.conversationId;
        let existingConv: Conversation | null = null;

        if (effectiveConversationId) {
          existingConv = await this.prisma.conversation.findFirst({
            where: {
              id: effectiveConversationId,
              organizationId,
              userId,
            },
          });

          if (!existingConv) {
            throw new NotFoundException('Conversation not found');
          }
        }

        // 1. Determine routing
        const routing = await this.routeRequest(
          organizationId,
          dto.message,
          effectiveConversationId,
          dto.forceReRoute,
          userId,
        );

        if (existingConv && existingConv.agentId !== routing.selectedAgentId) {
          this.logger.log(
            `Conversation ${effectiveConversationId} belongs to agent ${existingConv.agentId}, but supervisor selected ${routing.selectedAgentId}. Starting new conversation.`,
          );
          effectiveConversationId = undefined;
        }

        // 2. Emit routing decision block immediately so the UI can show which agent picked it up
        stream$.next({
          data: JSON.stringify({
            type: 'routing',
            routing,
          }),
        });

        // 3. Delegate to AgentExecutionService stream
        const innerStream$ = this.agentExecutionService.executeChatStream(
          organizationId,
          routing.selectedAgentId,
          dto.message,
          effectiveConversationId,
          userId,
        );

        innerStream$.subscribe({
          next: (val) => stream$.next(val),
          error: (err) => stream$.error(err),
          complete: () => stream$.complete(),
        });
      } catch (err: any) {
        this.logger.error(
          `Supervised stream routing failed: ${err.message}`,
          err.stack,
        );
        stream$.next({
          data: JSON.stringify({ type: 'error', error: err.message }),
        });
        stream$.complete();
      }
    })();

    return stream$.asObservable();
  }

  /**
   * Send agent definitions and query to AIService to route to best agent using structured output.
   */
  private async classifyAgent(
    agents: Array<{
      id: string;
      name: string;
      type: string;
      description: string | null;
    }>,
    userMessage: string,
  ): Promise<RoutingDecision> {
    if (!this.aiService.isConfigured()) {
      this.logger.warn(
        'AIService is not configured. Falling back to default agent.',
      );
      return this.fallbackDecision(agents, 'AIService not configured.');
    }

    const agentsCatalog = agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      type: a.type,
      description: a.description || 'General assistant agent',
    }));

    const systemPrompt = `You are an AI Supervisor and Router for an organization workforce.
Your task is to analyze the user message and route it to the single best-suited agent from the available agents list.

AVAILABLE AGENTS:
${JSON.stringify(agentsCatalog, null, 2)}

INSTRUCTIONS:
1. Compare the user's intent with the agent descriptions and types.
2. Select the single best-suited agent ID and explain the reason.
3. If no specialized agent clearly matches, choose the agent with type 'GENERAL' or the closest general helper.`;

    try {
      const parsed = await this.aiService.generateObject(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        {
          schema: routingDecisionSchema,
          schemaName: 'RoutingDecision',
          schemaDescription: 'Decision routing a user prompt to the best agent',
          temperature: 0.1,
        },
      );

      const chosenAgent = agents.find((a) => a.id === parsed.selectedAgentId);

      if (!chosenAgent) {
        this.logger.warn(
          `Supervisor router returned non-existent agentId: ${parsed.selectedAgentId}. Falling back.`,
        );
        return this.fallbackDecision(
          agents,
          'Supervisor router suggested unknown agent ID.',
        );
      }

      return {
        selectedAgentId: chosenAgent.id,
        agentName: chosenAgent.name,
        confidence:
          typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
        reason: parsed.reason || 'Agent matched user intent.',
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Error during supervisor evaluation: ${errorMessage}. Using fallback agent.`,
      );
      return this.fallbackDecision(
        agents,
        `Supervisor evaluation fallback: ${errorMessage}`,
      );
    }
  }

  /**
   * Deterministic fallback when the router is unavailable or returns an error.
   */
  private fallbackDecision(
    agents: Array<{ id: string; name: string; type: string }>,
    reason: string,
  ): RoutingDecision {
    const generalAgent = agents.find((a) => a.type === 'GENERAL') || agents[0];
    return {
      selectedAgentId: generalAgent.id,
      agentName: generalAgent.name,
      confidence: 0.5,
      reason,
    };
  }
}
