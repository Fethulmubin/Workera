import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SupervisorChatDto {
  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsString()
  @IsOptional()
  conversationId?: string;

  /**
   * If true, forces re-evaluation even if conversationId is already associated with an agent.
   */
  @IsOptional()
  forceReRoute?: boolean;
}

export interface RoutingDecision {
  selectedAgentId: string;
  agentName: string;
  confidence: number;
  reason: string;
}

export interface SupervisedChatResponse {
  routing: RoutingDecision;
  conversationId: string;
  message: any;
  citations: any[];
}