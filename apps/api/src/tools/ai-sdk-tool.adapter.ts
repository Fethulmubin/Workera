import { tool } from 'ai';
import type { ToolDefinition, ToolContext } from './types/tool.types';

export function toAISDKTool(
  definition: ToolDefinition,
  context: ToolContext,
) {
  return tool({
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: async (input) => {
      return definition.execute(input, context);
    },
  });
}