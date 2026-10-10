import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TEST_USER, provideTestHttp, signIn } from '../../testing/test-providers';
import { ModelSelection } from './model-selection';

const MODELS_URL = '/api/v1/reviews/models';
const LIST = { defaultModel: 'gemini-3.6-flash', models: ['gemini-3.6-flash', 'gemini-3.8-flash'] };

describe('ModelSelection', () => {
  let selection: ModelSelection;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [...provideTestHttp(), ModelSelection] });
    selection = TestBed.inject(ModelSelection);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows a loading state, then preselects and labels the default model', () => {
    selection.load();
    expect(selection.status()).toBe('loading');
    http.expectOne(MODELS_URL).flush(LIST);
    expect(selection.status()).toBe('ready');
    expect(selection.selected()).toBe('gemini-3.6-flash');
    expect(selection.options()).toEqual([
      { id: 'gemini-3.6-flash', isDefault: true, quotaReached: false },
      { id: 'gemini-3.8-flash', isDefault: false, quotaReached: false },
    ]);
    expect(selection.modelForRequest()).toBeUndefined();
  });

  it('sends nothing when the list is unavailable, so reviewing is never blocked', () => {
    selection.load();
    http.expectOne(MODELS_URL).flush(null, { status: 503, statusText: 'Unavailable' });
    expect(selection.status()).toBe('unavailable');
    expect(selection.selected()).toBeNull();
    expect(selection.modelForRequest()).toBeUndefined();
  });

  it('treats a malformed list (default missing from models) as unavailable', () => {
    selection.load();
    http.expectOne(MODELS_URL).flush({ defaultModel: 'x', models: ['y'] });
    expect(selection.status()).toBe('unavailable');
  });

  it('sends the chosen model and remembers it per user', () => {
    signIn(TEST_USER);
    selection.load();
    http.expectOne(MODELS_URL).flush(LIST);
    selection.select('gemini-3.8-flash');
    expect(selection.modelForRequest()).toBe('gemini-3.8-flash');
    expect(localStorage.getItem(`contentReview.reviewModel.user.${TEST_USER.id}`)).toBe(
      'gemini-3.8-flash',
    );
  });

  it('restores the remembered model only if it is still offered', () => {
    signIn(TEST_USER);
    const key = `contentReview.reviewModel.user.${TEST_USER.id}`;
    localStorage.setItem(key, 'gemini-3.8-flash');
    selection.load();
    http.expectOne(MODELS_URL).flush(LIST);
    expect(selection.selected()).toBe('gemini-3.8-flash');

    localStorage.setItem(key, 'retired-model');
    selection.handleRejected();
    http.expectOne(MODELS_URL).flush(LIST);
    expect(selection.selected()).toBe('gemini-3.6-flash');
  });

  it('resets to the default and reloads the list when the server rejects the model', () => {
    selection.load();
    http.expectOne(MODELS_URL).flush(LIST);
    selection.select('gemini-3.8-flash');
    selection.handleRejected();
    expect(selection.selected()).toBe('gemini-3.6-flash');
    http
      .expectOne(MODELS_URL)
      .flush({ defaultModel: 'gemini-3.6-flash', models: ['gemini-3.6-flash'] });
    expect(selection.options().map((o) => o.id)).toEqual(['gemini-3.6-flash']);
  });

  it('marks a model whose quota ran out, moves off it and offers another', () => {
    selection.load();
    http.expectOne(MODELS_URL).flush(LIST);
    selection.markQuotaReached('gemini-3.6-flash', null);
    expect(selection.options()[0].quotaReached).toBe(true);
    expect(selection.selected()).toBe('gemini-3.8-flash');
    selection.select('gemini-3.6-flash'); // not selectable while exhausted
    expect(selection.selected()).toBe('gemini-3.8-flash');
    expect(selection.hasAlternative('gemini-3.6-flash')).toBe(true);
    expect(selection.hasAlternative('gemini-3.8-flash')).toBe(false);
  });

  it('selects the next model after the failed one, wrapping and skipping exhausted ones', () => {
    selection.load();
    http.expectOne(MODELS_URL).flush({
      defaultModel: 'a-1',
      models: ['a-1', 'b-2', 'c-3'],
    });
    expect(selection.selectNextAvailable('a-1')).toBe(true);
    expect(selection.selected()).toBe('b-2');
    selection.markQuotaReached('c-3', null);
    expect(selection.selectNextAvailable('b-2')).toBe(true);
    expect(selection.selected()).toBe('a-1'); // wrapped past exhausted c-3
    selection.markQuotaReached('b-2', null);
    expect(selection.selectNextAvailable('a-1')).toBe(false);
    expect(selection.selected()).toBe('a-1');
  });
});
