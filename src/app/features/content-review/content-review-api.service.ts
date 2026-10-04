import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { toCreatedReview, toReview, toReviewPage, toUpdatedFinding } from './review.mappers';
import type {
  CreateReviewRequest,
  CreateReviewRequestDto,
  CreatedReview,
  Finding,
  FindingActionDto,
  Review,
  ReviewPage,
  ReviewStatus,
  UpdateFindingRequestDto,
} from './review.models';

/**
 * Typed client for the review endpoints of the Node ContentReviewService. Every response is
 * shape-checked and mapped to the UI's domain types; a malformed body becomes an
 * `InvalidResponseError` instead of leaking `undefined` into components.
 */
@Service()
export class ContentReviewApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${inject(APP_CONFIG).apiBaseUrl}/reviews`;

  /** Queues a review (`202 Accepted`). Results arrive over {@link ReviewEventsService}. */
  createReview(request: CreateReviewRequest): Observable<CreatedReview> {
    const body: CreateReviewRequestDto = {
      documentTitle: request.title,
      content: request.content,
      categories: request.categories,
    };
    return this.http.post<unknown>(this.baseUrl, body).pipe(map(toCreatedReview));
  }

  listReviews(page: number, limit: number, status?: ReviewStatus): Observable<ReviewPage> {
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (status) params['status'] = status;
    return this.http.get<unknown>(this.baseUrl, { params }).pipe(map(toReviewPage));
  }

  getReview(reviewId: string): Observable<Review> {
    return this.http.get<unknown>(this.reviewUrl(reviewId)).pipe(map(toReview));
  }

  /**
   * Sets a finding to `accepted` or `dismissed`. `content` is the review's content, needed to
   * convert the returned code-point offsets.
   */
  updateFindingStatus(
    reviewId: string,
    findingId: string,
    status: FindingActionDto,
    content: string,
  ): Observable<Finding> {
    const body: UpdateFindingRequestDto = { status };
    return this.http
      .patch<unknown>(`${this.reviewUrl(reviewId)}/findings/${encodeURIComponent(findingId)}`, body)
      .pipe(map((response) => toUpdatedFinding(response, content)));
  }

  eventsUrl(reviewId: string, lastEventId?: number): string {
    const base = `${this.reviewUrl(reviewId)}/events`;
    return lastEventId ? `${base}?lastEventId=${lastEventId}` : base;
  }

  private reviewUrl(reviewId: string): string {
    return `${this.baseUrl}/${encodeURIComponent(reviewId)}`;
  }
}
