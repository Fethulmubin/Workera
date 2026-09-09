import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  similarity: number;
}

@Injectable()
export class VectorStoreService {
  constructor(private readonly prisma: PrismaService) {}
}
