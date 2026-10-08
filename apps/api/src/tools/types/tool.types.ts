import type { ZodType } from 'zod';

export interface ToolContext {
  organizationId: string;
  agentId: string;
  userId?: string;
  anonymousSessionId?: string;
  conversationId?: string;
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  execute: (
    input: TInput,
    context: ToolContext,
  ) => Promise<TOutput>;
}
