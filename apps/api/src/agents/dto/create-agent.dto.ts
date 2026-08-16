import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AgentType } from '@ai-workforce/database';

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @IsEnum(AgentType)
  @IsOptional()
  type?: AgentType;

  @IsString()
  @IsOptional()
  systemPrompt?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}