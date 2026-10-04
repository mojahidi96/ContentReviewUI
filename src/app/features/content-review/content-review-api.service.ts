import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { REQUEST_TIMEOUT_MS } from '../../core/http/http-context';
import type {
  CreateReviewRequest,
  Finding,
  FindingStatus,
  Review,
  ReviewListResponse,
  ReviewSummary,
  UpdateFindingRequest,
} from './review.models';

/** Typed client for the review endpoints of the Node ContentReviewService. */
@Service()
export class ContentReviewApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(APP_CONFIG);
  private readonly baseUrl = `${this.config.apiBaseUrl}/reviews`;

  createReview(request: CreateReviewRequest): Observable<Review> {
    return this.http.post<Review>(this.baseUrl, request, {
      context: new HttpContext().set(REQUEST_TIMEOUT_MS, this.config.reviewTimeoutMs),
    });
  }

  listReviews(): Observable<readonly ReviewSummary[]> {
    return this.http.get<ReviewListResponse>(this.baseUrl).pipe(map(({ items }) => items));
  }

  getReview(reviewId: string): Observable<Review> {
    return this.http.get<Review>(`${this.baseUrl}/${encodeURIComponent(reviewId)}`);
  }

  updateFindingStatus(
    reviewId: string,
    findingId: string,
    status: FindingStatus,
  ): Observable<Finding> {
    const body: UpdateFindingRequest = { status };
    return this.http.patch<Finding>(
      `${this.baseUrl}/${encodeURIComponent(reviewId)}/findings/${encodeURIComponent(findingId)}`,
      body,
    );
  }
}
