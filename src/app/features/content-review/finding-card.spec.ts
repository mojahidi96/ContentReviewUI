import { ComponentFixture, TestBed } from '@angular/core/testing';
import { makeFinding } from '../../testing/test-providers';
import { FindingCard } from './finding-card';
import type { Finding } from './review.models';
import type { FindingActions } from './review.store';

const NONE: FindingActions = { applied: false, canAccept: false, canUndo: false, note: null };

describe('FindingCard', () => {
  let fixture: ComponentFixture<FindingCard>;
  let el: HTMLElement;

  const render = async (finding: Finding, inputs: Record<string, unknown> = {}) => {
    fixture.componentRef.setInput('finding', finding);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    await fixture.whenStable();
  };
  const button = (text: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

  beforeEach(() => {
    fixture = TestBed.createComponent(FindingCard);
    el = fixture.nativeElement;
  });

  it('labels category, severity and status with text, and marks the AI suggestion', async () => {
    await render(makeFinding({ category: 'vulgar_language', severity: 'high' }));
    expect(el.textContent).toContain('Inappropriate language');
    expect(el.textContent).toContain('High severity');
    expect(el.textContent).toContain('Needs review');
    expect(el.textContent).toContain('AI suggestion');
  });

  it('shows the original text, the improved text and the explanation as labelled rows', async () => {
    await render(makeFinding());
    const rows = [...el.querySelectorAll('dl > div')].map((row) => ({
      label: row.querySelector('dt')!.textContent!.trim(),
      value: row.querySelector('dd')!.textContent!.trim(),
    }));
    expect(rows).toEqual([
      { label: 'Original:', value: 'Highlight in document: teh' },
      { label: 'Improved (AI suggestion):', value: 'the' },
      { label: 'Explanation:', value: '"teh" is misspelled.' },
    ]);
    expect(el.querySelector('q')!.className).not.toContain('line-through');
  });

  it('omits the Improved row when there is no suggestion, and explains removals', async () => {
    await render(makeFinding({ suggestion: undefined }));
    expect(el.textContent).not.toContain('Improved');
    await render(makeFinding({ suggestion: '' }));
    expect(el.textContent).toContain('Remove this text');
  });

  it('renders unknown categories as readable labels', async () => {
    await render(makeFinding({ category: 'brand_voice' }));
    expect(el.textContent).toContain('Brand voice');
  });

  it('always shows Undo before Accept, enabling only the one that applies', async () => {
    const accept = vi.fn();
    const undo = vi.fn();
    fixture.componentInstance.acceptRequested.subscribe(accept);
    fixture.componentInstance.undoRequested.subscribe(undo);
    const actionLabels = () =>
      [...el.querySelectorAll('[data-card-body] .justify-end button')].map((b) =>
        b.textContent!.trim(),
      );

    await render(makeFinding(), { actions: { ...NONE, canAccept: true } });
    expect(actionLabels()).toEqual(['Undo', 'Accept']);
    expect(button('Undo')!.disabled).toBe(true);
    button('Accept')!.click();
    expect(accept).toHaveBeenCalledOnce();

    await render(makeFinding({ status: 'accepted' }), {
      actions: { ...NONE, applied: true, canUndo: true },
    });
    expect(actionLabels()).toEqual(['Undo', 'Accept']);
    expect(button('Accept')!.disabled).toBe(true);
    button('Undo')!.click();
    expect(undo).toHaveBeenCalledOnce();
  });

  it('disables Accept and shows why when it is unavailable', async () => {
    await render(makeFinding(), { actions: { ...NONE, note: 'Nothing to apply.' } });
    expect(button('Accept')!.disabled).toBe(true);
    expect(el.textContent).toContain('Nothing to apply.');
  });

  it('offers no actions once the finding is saved', async () => {
    await render(makeFinding({ status: 'resolved' }));
    expect(button('Accept')).toBeUndefined();
    expect(button('Undo')).toBeUndefined();
  });

  it('expands and collapses from a one-line header', async () => {
    const toggled = vi.fn();
    fixture.componentInstance.expandedToggle.subscribe(toggled);
    await render(makeFinding(), { expanded: false });
    const header = el.querySelector<HTMLButtonElement>('h3 button')!;
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.querySelector('.truncate')!.textContent).toContain('teh');
    expect(el.querySelector<HTMLElement>('#finding-body-fnd_1')!.hidden).toBe(true);
    header.click();
    expect(toggled).toHaveBeenCalledOnce();
  });

  it('highlights from the card body but not from the header or the actions', async () => {
    const selected = vi.fn();
    fixture.componentInstance.selected.subscribe(selected);
    await render(makeFinding(), { active: true, actions: { ...NONE, canAccept: true } });

    el.querySelector<HTMLButtonElement>('h3 button')!.click();
    button('Accept')!.click();
    expect(selected).not.toHaveBeenCalled();

    el.querySelector<HTMLElement>('#finding-fnd_1')!.click();
    const excerpt = el.querySelector<HTMLButtonElement>('dd button')!;
    expect(excerpt.getAttribute('aria-pressed')).toBe('true');
    excerpt.click();
    expect(selected).toHaveBeenCalledTimes(2);
  });

  it('is not selectable when the finding has no location', async () => {
    const selected = vi.fn();
    fixture.componentInstance.selected.subscribe(selected);
    await render(makeFinding({ range: undefined }));
    expect(el.querySelector('dd button')).toBeNull();
    el.querySelector<HTMLElement>('#finding-fnd_1')!.click();
    expect(selected).not.toHaveBeenCalled();
  });
});
