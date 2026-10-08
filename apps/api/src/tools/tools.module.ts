import { Module } from '@nestjs/common';
// import { CalculatorTool } from './calculator.tool';
import { DateTimeTool } from './date-time.tool';
import { ToolRegistry } from './tool.registry';
import { ToolRegistrar } from './tool-registrar.service';
import { ToolAccessService } from './tool-access.service';

@Module({
  providers: [
    ToolRegistry,
    DateTimeTool,
    ToolRegistrar,
    ToolAccessService,
  ],
  exports: [ToolRegistry, ToolAccessService],
})
export class ToolsModule {}