export const DOCUMENT_INGESTION_QUEUE = 'document-ingestion';

export interface DocumentIngestionJobData {
  documentId: string;
  rawText: string;
}