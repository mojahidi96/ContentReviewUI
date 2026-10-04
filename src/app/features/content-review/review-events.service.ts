import { InjectionToken, Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { ContentReviewApiService } from './content-review-api.service';
import { parseEventData, toFinding } from './review.mappers';
import { REVIEW_EVENT_TYPES, type ReviewEventType, type ReviewProgress } from './review.models';

/** The subset of `EventSource` the UI uses, so tests can substitute a fake. */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string, init: EventSourceInit) => EventSourceLike;

export const EVENT_SOURCE_FACTORY = new InjectionToken<EventSourceFactory>('EVENT_SOURCE_FACTORY', {
  providedIn: 'root',
  factory: () => (url, init) => new EventSource(url, init),
});

/** `EventSource.CLOSED`, without relying on the global in non-browser test environments. */
const CLOSED = 2;

/**
 * The stream ended without a terminal event and the browser will not reconnect on its own
 * (any non-200 response — `204`, `401`, `404`, `5xx` — or too many failed reconnects).
 * `lastEventId` lets the caller resume without replaying what it already handled.
 */
export class ReviewStreamClosedError extends Error {
  constructor(readonly lastEventId: number) {
    super('The review event stream closed before the review finished.');
    this.name = 'ReviewStreamClosedError';
  }
}

/**
 * Follows `GET /reviews/:id/events` (Server-Sent Events from Node, never Python).
 *
 * Authentication is the session cookie, sent because the stream is same-origin and opened with
 * `withCredentials`; no token ever goes in the URL. Events are de-duplicated by their increasing
 * `id` (delivery is at-least-once). The observable completes after `review.completed` or
 * `review.failed`, and unsubscribing always closes the connection.
 */
@Service()
export class ReviewEventsService {
  private readonly api = inject(ContentReviewApiService);
  private readonly createEventSource = inject(EVENT_SOURCE_FACTORY);
  private readonly maxErrors = inject(APP_CONFIG).reviewEvents.maxReconnects;

  follow(reviewId: string, afterEventId = 0): Observable<ReviewProgress> {
    return new Observable<ReviewProgress>((subscriber) => {
      let lastEventId = afterEventId;
      let consecutiveErrors = 0;
      const source = this.createEventSource(this.api.eventsUrl(reviewId, afterEventId), {
        withCredentials: true,
      });

      const handle = (type: ReviewEventType, event: MessageEvent<string>) => {
        const id = Number(event.lastEventId);
        if (Number.isInteger(id) && id > 0) {
          if (id <= lastEventId) return; // replayed after a reconnect
          lastEventId = id;
        }
        let progress: ReviewProgress;
        try {
          progress = toProgress(type, event.data);
        } catch (error) {
          source.close();
          subscriber.error(error);
          return;
        }
        subscriber.next(progress);
        if (progress.kind === 'completed' || progress.kind === 'failed') {
          // The server closes the stream too; closing here stops the browser reconnecting.
          source.close();
          subscriber.complete();
        }
      };

      for (const type of REVIEW_EVENT_TYPES) {
        source.addEventListener(type, (event) => handle(type, event));
      }
      source.onopen = () => (consecutiveErrors = 0);
      source.onerror = () => {
        consecutiveErrors++;
        // CONNECTING means the browser is retrying with Last-Event-ID; let it, within reason.
        if (source.readyState === CLOSED || consecutiveErrors > this.maxErrors) {
          source.close();
          subscriber.error(new ReviewStreamClosedError(lastEventId));
        }
      };

      return () => source.close();
    });
  }
}

function toProgress(type: ReviewEventType, raw: string): ReviewProgress {
  switch (type) {
    case 'review.started':
      parseEventData(type, raw);
      return { kind: 'started' };
    case 'review.progress': {
      const data = parseEventData(type, raw);
      return { kind: 'progress', stage: data.stage, attempt: data.attempt };
    }
    case 'finding.detected': {
      const data = parseEventData(type, raw);
      // Offsets are only meaningful against the content, which the final GET provides.
      return { kind: 'finding', findingId: toFinding(data.finding, '').id };
    }
    case 'review.completed':
      return { kind: 'completed', findingCount: parseEventData(type, raw).findingCount };
    case 'review.failed':
      return { kind: 'failed', errorCode: parseEventData(type, raw).errorCode };
  }
}
