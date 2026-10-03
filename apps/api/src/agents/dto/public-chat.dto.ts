import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class PublicChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  conversationId?: string;
}
