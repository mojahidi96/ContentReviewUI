// ================================================================ domain

/** A document as saved in Node. `content` is exactly what the author wrote. */
export interface SavedDocument {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  /** Optimistic-concurrency version; send it back with the next save. */
  readonly version: number;
  readonly updatedAt: string;
}

export interface SavedDocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly version: number;
  readonly updatedAt: string;
}

// ================================================================ wire format (Node v1)

export interface DocumentSummaryDto {
  readonly documentId: string;
  readonly title: string;
  readonly contentLength: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DocumentDto extends DocumentSummaryDto {
  readonly content: string;
}

/** Body of `POST /documents`. */
export interface CreateDocumentRequestDto {
  readonly title: string;
  readonly content: string;
}

/** Body of `PUT /documents/:id`. */
export interface UpdateDocumentRequestDto extends CreateDocumentRequestDto {
  readonly version: number;
}

export interface DocumentResponseDto {
  readonly document: DocumentDto;
}

export interface DocumentPageDto {
  readonly items: readonly DocumentSummaryDto[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}
