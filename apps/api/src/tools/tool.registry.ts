import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ToolDefinition } from './types/tool.types';

@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    if (!tool.name.trim()) {
      throw new Error('Tool name cannot be empty');
    }

    if (!tool.description.trim()) {
      throw new Error(`Tool "${tool.name}" must have a description`);
    }

    this.tools.set(tool.name, tool);
    this.logger.debug(`Registered tool: ${tool.name}`);
  }

  get(name: string): ToolDefinition {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new NotFoundException(`Tool "${name}" is not registered`);
    }

    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(
    name: string,
    input: unknown,
    context: Parameters<ToolDefinition['execute']>[1],
  ): Promise<unknown> {
    const tool = this.get(name);

    const parsedInput = tool.inputSchema.safeParse(input);

    if (!parsedInput.success) {
      throw new BadRequestException({
        message: `Invalid input for tool "${name}"`,
        issues: parsedInput.error.issues,
      });
    }

    return tool.execute(parsedInput.data, context);
  }
}
