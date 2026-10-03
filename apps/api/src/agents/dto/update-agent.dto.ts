import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { AgentType } from "@ai-workforce/database";

export class UpdateAgentDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsEnum(AgentType)
  @IsOptional()
  type?: AgentType;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  systemPrompt?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
