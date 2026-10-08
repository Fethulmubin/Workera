import { Injectable, OnModuleInit } from '@nestjs/common';
import { DateTimeTool } from './date-time.tool';
import { ToolRegistry } from './tool.registry';

@Injectable()
export class ToolRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly dateTimeTool: DateTimeTool,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.dateTimeTool);
  }
}

