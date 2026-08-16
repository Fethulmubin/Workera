import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { OrganizationRole } from '@ai-workforce/database';

export class AddMemberDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsEnum(OrganizationRole)
  role!: OrganizationRole;
}