import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { UpdateConversationDto } from './dto/update-conversation.dto';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async findOwnedConversation(
    conversationId: string,
    organizationId: string,
    userId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
        userId,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  async list(
    organizationId: string,
    userId: string,
  ) {
    return this.prisma.conversation.findMany({
      where: {
        organizationId,
        userId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });
  }

  async findOne(
    conversationId: string,
    organizationId: string,
    userId: string,
  ) {
    const conversation = await this.findOwnedConversation(
      conversationId,
      organizationId,
      userId,
    );

    return this.prisma.conversation.findUnique({
      where: {
        id: conversation.id,
      },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });
  }

  async getMessages(
    conversationId: string,
    organizationId: string,
    userId: string,
  ) {
    await this.findOwnedConversation(
      conversationId,
      organizationId,
      userId,
    );

    return this.prisma.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async update(
    conversationId: string,
    organizationId: string,
    userId: string,
    dto: UpdateConversationDto,
  ) {
    const conversation = await this.findOwnedConversation(
      conversationId,
      organizationId,
      userId,
    );

    return this.prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        title: dto.title,
      },
    });
  }

  async remove(
    conversationId: string,
    organizationId: string,
    userId: string,
  ) {
    const conversation = await this.findOwnedConversation(
      conversationId,
      organizationId,
      userId,
    );

    await this.prisma.conversation.delete({
      where: {
        id: conversation.id,
      },
    });

    return {
      message: 'Conversation deleted successfully',
    };
  }
}