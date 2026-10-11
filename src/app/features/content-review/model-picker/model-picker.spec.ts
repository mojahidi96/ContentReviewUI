import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTestHttp } from '../../../testing/test-providers';
import { ModelSelection } from '../model-selection';
import { ModelPicker, modelLabel } from './model-picker';

const LIST = { defaultModel: 'gemini-3.6-flash', models: ['gemini-3.6-flash', 'gemini-3.8-flash'] };

describe('ModelPicker', () => {
  let fixture: ComponentFixture<ModelPicker>;
  let el: HTMLElement;
  let http: HttpTestingController;
  let models: ModelSelection;

  const select = () => el.querySelector<HTMLSelectElement>('#review-model');

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [...provideTestHttp(), ModelSelection] });
    models = TestBed.inject(ModelSelection);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ModelPicker);
    el = fixture.nativeElement;
    models.load();
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('shows a loading state while the list loads', () => {
    expect(el.textContent).toContain('Loading models');
    http.expectOne('/api/v1/reviews/models').flush(LIST);
  });

  it('lists the models, labels and preselects the default', async () => {
    http.expectOne('/api/v1/reviews/models').flush(LIST);
    await fixture.whenStable();
    const options = [...el.querySelectorAll('option')].map((o) => o.textContent!.trim());
    expect(options).toEqual(['Gemini 3.6 Flash (default)', 'Gemini 3.8 Flash']);
    expect(select()!.value).toBe('gemini-3.6-flash');
    expect(el.querySelector('label[for=review-model]')?.textContent).toContain('Model');
    expect(el.querySelector('[data-testid=model-id]')?.textContent?.trim()).toBe(
      'gemini-3.6-flash',
    );
  });

  it('changes the selection', async () => {
    http.expectOne('/api/v1/reviews/models').flush(LIST);
    await fixture.whenStable();
    select()!.value = 'gemini-3.8-flash';
    select()!.dispatchEvent(new Event('change'));
    expect(models.modelForRequest()).toBe('gemini-3.8-flash');
  });

  it('marks and disables a model whose quota is reached', async () => {
    http.expectOne('/api/v1/reviews/models').flush(LIST);
    models.markQuotaReached('gemini-3.8-flash', null);
    await fixture.whenStable();
    const option = [...el.querySelectorAll('option')].find((o) => o.value === 'gemini-3.8-flash')!;
    expect(option.disabled).toBe(true);
    expect(option.textContent).toContain('quota reached');
  });

  it('replaces the dropdown with a note when the list is unavailable', async () => {
    http.expectOne('/api/v1/reviews/models').flush(null, { status: 503, statusText: 'No' });
    await fixture.whenStable();
    expect(select()).toBeNull();
    expect(el.textContent).toContain('Using the default model');
  });
});

describe('modelLabel', () => {
  it('makes plain ids readable and leaves anything else untouched', () => {
    expect(modelLabel('gemini-3.8-pro')).toBe('Gemini 3.8 Pro');
    expect(modelLabel('Custom Model_X')).toBe('Custom Model_X');
    expect(modelLabel('models/gemini')).toBe('models/gemini');
  });
});
