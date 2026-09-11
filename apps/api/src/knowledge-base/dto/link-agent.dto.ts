import { IsNotEmpty, IsString } from 'class-validator';

export class LinkAgentDto {
  @IsString()
  @IsNotEmpty()
  agentId!: string;
}