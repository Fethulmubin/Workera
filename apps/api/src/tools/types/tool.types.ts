import type { ZodType } from 'zod';

export interface ToolContext {
  organizationId: string;
  agentId: string;
  userId?: string;
  anonymousSessionId?: string;
  conversationId?: string;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  execute: (
    input: TInput,
    context: ToolContext,
  ) => Promise<TOutput>;
}
