import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { InvalidResponseError } from '../../core/http/api-error';
import type {
  CreateDocumentRequestDto,
  SavedDocument,
  SavedDocumentSummary,
  UpdateDocumentRequestDto,
} from './document.models';

/**
 * Typed client for Node's `/documents` endpoints. Content is sent and received untouched:
 * no trimming or normalisation happens on either side, so formatting round-trips exactly.
 */
@Service()
export class DocumentApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${inject(APP_CONFIG).apiBaseUrl}/documents`;

  create(title: string, content: string): Observable<SavedDocument> {
    const body: CreateDocumentRequestDto = { title, content };
    return this.http.post<unknown>(this.baseUrl, body).pipe(map(toSavedDocument));
  }

  update(id: string, title: string, content: string, version: number): Observable<SavedDocument> {
    const body: UpdateDocumentRequestDto = { title, content, version };
    return this.http.put<unknown>(this.documentUrl(id), body).pipe(map(toSavedDocument));
  }

  get(id: string): Observable<SavedDocument> {
    return this.http.get<unknown>(this.documentUrl(id)).pipe(map(toSavedDocument));
  }

  /** The author's most recently updated document, or `null` if they have none. */
  latest(): Observable<SavedDocumentSummary | null> {
    return this.http
      .get<unknown>(this.baseUrl, { params: { page: '1', limit: '1' } })
      .pipe(map(toLatestSummary));
  }

  private documentUrl(id: string): string {
    return `${this.baseUrl}/${encodeURIComponent(id)}`;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toSummary(d: unknown, what: string): SavedDocumentSummary {
  if (
    !isRecord(d) ||
    typeof d['documentId'] !== 'string' ||
    typeof d['title'] !== 'string' ||
    !Number.isInteger(d['version']) ||
    typeof d['updatedAt'] !== 'string'
  ) {
    throw new InvalidResponseError(what);
  }
  return {
    id: d['documentId'],
    title: d['title'],
    version: d['version'] as number,
    updatedAt: d['updatedAt'],
  };
}

export function toSavedDocument(body: unknown): SavedDocument {
  const doc = isRecord(body) ? body['document'] : undefined;
  const summary = toSummary(doc, 'document');
  const content = isRecord(doc) ? doc['content'] : undefined;
  if (typeof content !== 'string') {
    throw new InvalidResponseError('document.content');
  }
  return { ...summary, content };
}

function toLatestSummary(body: unknown): SavedDocumentSummary | null {
  const items = isRecord(body) ? body['items'] : undefined;
  if (!Array.isArray(items)) {
    throw new InvalidResponseError('document list');
  }
  return items.length === 0 ? null : toSummary(items[0], 'document list item');
}
