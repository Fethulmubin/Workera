import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';


@Module({
  imports: [AuthModule, TenantModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}