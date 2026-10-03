import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import { PrismaService } from '../database/prisma.service';
import { AgentExecutionService } from './agent-execution.service';
import {
  RoutingDecision,
  SupervisedChatResponse,
  SupervisorChatDto,
} from './dto/supervisor-chat.dto';
import { AgentType } from '@ai-workforce/database';

@Injectable()
export class AgentSupervisorService {
  private readonly logger = new Logger(AgentSupervisorService.name);
  private readonly openRouterApiKey: string;
  private readonly routerModel: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentExecutionService: AgentExecutionService,
    private readonly configService: ConfigService,
  ) {
    this.openRouterApiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.routerModel =
      this.configService.get<string>('OPENROUTER_ROUTER_MODEL') ||
      'typesafe/jev-router';
  }

  /**
 * Ensures an organization always has at least one active General Agent.
 */
private async getOrCreateDefaultGeneralAgent(organizationId: string) {
  const org = await this.prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  const orgName = org?.name || 'Company';

  this.logger.log(`Auto-provisioning default General Agent for organization: ${organizationId}`);

  return this.prisma.agent.create({
    data: {
      organizationId,
      name: `${orgName} Assistant`,
      type: AgentType.GENERAL,
      description: 'Primary organization assistant for general inquiries, drafting, and workplace productivity.',
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
    if (conversationId && !forceReRoute) {
      const existingConv = await this.prisma.conversation.findFirst({
        where: {
          id: conversationId,
          organizationId,
          ...(userId ? { userId } : {}),
        },
        include: { agent: true },
      });

      if (existingConv && existingConv.agent) {
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

    // 4. Call typesafe/jev-router via OpenRouter
    return this.classifyWithJevRouter(availableAgents, userMessage);
  }

  /**
   * Execute chat by automatically routing to the chosen agent.
   */
  async executeSupervisedChat(
    organizationId: string,
    dto: SupervisorChatDto,
    userId?: string,
  ): Promise<SupervisedChatResponse> {
    const routing = await this.routeRequest(
      organizationId,
      dto.message,
      dto.conversationId,
      dto.forceReRoute,
      userId,
    );

    this.logger.log(
      `Supervisor routed query to "${routing.agentName}" (${routing.selectedAgentId}). Reason: ${routing.reason}`,
    );

    const executionResult = await this.agentExecutionService.executeChat(
      organizationId,
      routing.selectedAgentId,
      dto.message,
      dto.conversationId,
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
    userId?: string,
  ): Observable<{ data: string }> {
    const stream$ = new Subject<{ data: string }>();

    (async () => {
      try {
        // 1. Determine routing
        const routing = await this.routeRequest(
          organizationId,
          dto.message,
          dto.conversationId,
          dto.forceReRoute,
          userId,
        );

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
          dto.conversationId,
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
   * Send agent definitions and query to OpenRouter using typesafe/jev-router.
   */
  private async classifyWithJevRouter(
    agents: Array<{
      id: string;
      name: string;
      type: string;
      description: string | null;
    }>,
    userMessage: string,
  ): Promise<RoutingDecision> {
    if (!this.openRouterApiKey) {
      this.logger.warn(
        'OPENROUTER_API_KEY is missing. Falling back to default agent.',
      );
      return this.fallbackDecision(
        agents,
        'OPENROUTER_API_KEY not configured.',
      );
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
2. Output strictly a JSON object with this structure:
{
  "selectedAgentId": "<ID of chosen agent>",
  "confidence": <number between 0.0 and 1.0>,
  "reason": "<brief justification in one sentence>"
}
3. If no specialized agent clearly matches, choose the agent with type 'GENERAL' or the closest general helper.
4. Output valid JSON ONLY. Do not write markdown blocks or additional prose.`;

    try {
      const response = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ai-workforce.local', // Recommended by OpenRouter
            'X-Title': 'AI Workforce Supervisor',
          },
          body: JSON.stringify({
            model: this.routerModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenRouter router call failed (${response.status}): ${errorText}`,
        );
      }

      const data = await response.json();
      const rawContent = data.choices?.[0]?.message?.content?.trim();

      if (!rawContent) {
        throw new Error('Empty response from Jev Router');
      }

      // Parse JSON from router output
      const parsed = JSON.parse(rawContent);
      const chosenAgent = agents.find((a) => a.id === parsed.selectedAgentId);

      if (!chosenAgent) {
        this.logger.warn(
          `Router returned non-existent agentId: ${parsed.selectedAgentId}. Falling back.`,
        );
        return this.fallbackDecision(
          agents,
          'Router suggested unknown agent ID.',
        );
      }

      return {
        selectedAgentId: chosenAgent.id,
        agentName: chosenAgent.name,
        confidence:
          typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
        reason: parsed.reason || 'Agent matched user intent.',
      };
    } catch (err: any) {
      this.logger.error(
        `Error during Jev Router evaluation: ${err.message}. Using fallback agent.`,
      );
      return this.fallbackDecision(
        agents,
        `Router evaluation fallback: ${err.message}`,
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
