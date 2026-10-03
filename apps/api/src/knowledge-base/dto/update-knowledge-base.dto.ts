import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateKnowledgeBaseDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;
}
