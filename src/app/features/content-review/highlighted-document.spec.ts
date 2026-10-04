import { ComponentFixture, TestBed } from '@angular/core/testing';
import { makeFinding } from '../../testing/test-providers';
import { HighlightedDocument } from './highlighted-document';
import type { Finding } from './review.models';

describe('HighlightedDocument', () => {
  let fixture: ComponentFixture<HighlightedDocument>;

  const render = async (text: string, findings: Finding[], active: string | null = null) => {
    fixture.componentRef.setInput('text', text);
    fixture.componentRef.setInput('findings', findings);
    fixture.componentRef.setInput('activeFindingId', active);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  /** The document text as rendered, without the inline AI suggestion chips. */
  const documentText = (el: HTMLElement) => {
    const copy = el.querySelector('div')!.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-suggestion], [data-original]').forEach((s) => s.remove());
    return copy.textContent;
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(HighlightedDocument);
  });

  it('renders the document text exactly, including whitespace', async () => {
    const text = '  Line one\n\nLine teh two\t😀 end  ';
    const el = await render(text, [makeFinding({ range: { start: 17, end: 20 } })]);
    expect(documentText(el)).toBe(text);
    expect(el.querySelector('mark')!.textContent).toBe('teh');
  });

  it('renders overlapping findings without duplicating text', async () => {
    const text = 'The the data shows';
    const el = await render(text, [
      makeFinding({ id: 'a', range: { start: 0, end: 7 } }),
      makeFinding({ id: 'b', category: 'grammar', range: { start: 4, end: 18 } }),
    ]);
    const marks = [...el.querySelectorAll('mark')];
    expect(marks.map((m) => m.textContent)).toEqual(['The ', 'the', ' data shows']);
    expect(marks.map((m) => m.dataset['findingIds'])).toEqual(['a', 'a b', 'b']);
    expect(documentText(el)).toBe(text);
  });

  it('never interprets document content as HTML', async () => {
    const text = '<img src=x onerror=alert(1)> <b>bold</b>';
    const el = await render(text, [makeFinding({ range: { start: 0, end: 5 } })]);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(documentText(el)).toBe(text);
  });

  it('shows each AI suggestion right after the text it replaces', async () => {
    const el = await render('the teh cat sat', [
      makeFinding({ id: 'a', suggestion: 'the', range: { start: 4, end: 7 } }),
      makeFinding({ id: 'b', suggestion: '', range: { start: 12, end: 15 } }),
      makeFinding({ id: 'c', suggestion: undefined, range: { start: 8, end: 11 } }),
    ]);
    const chips = [...el.querySelectorAll<HTMLElement>('[data-suggestion]')];
    expect(chips.map((c) => c.textContent)).toEqual([
      'AI suggestion: → the',
      'AI suggestion: → remove this text',
    ]);
    expect(chips[0].previousElementSibling!.textContent).toBe('teh');
    expect(chips[1].previousElementSibling!.textContent).toBe('sat');
  });

  it('shows applied changes in green without a suggestion chip', async () => {
    fixture.componentRef.setInput('appliedIds', new Set(['a']));
    const el = await render('the the cat', [
      makeFinding({ id: 'a', excerpt: 'teh', suggestion: 'the', range: { start: 4, end: 7 } }),
    ]);
    const mark = el.querySelector('mark')!;
    expect(mark.className).toContain('bg-emerald-100');
    expect(el.querySelector('[data-suggestion]')).toBeNull();
    const original = mark.previousElementSibling!;
    expect(original.tagName).toBe('DEL');
    expect(original.textContent).toBe('Original text: teh');
    expect(documentText(el)).toBe('the the cat');
  });

  it('links highlights to finding explanations for assistive technology', async () => {
    const el = await render('the teh cat', [makeFinding({ id: 'x1' })]);
    expect(el.querySelector('mark')!.getAttribute('aria-describedby')).toBe('finding-x1');
  });

  it('focuses and scrolls to the active finding', async () => {
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    const el = await render('the teh cat', [makeFinding({ id: 'x1' })], 'x1');
    await fixture.whenStable();
    const mark = el.querySelector('mark')!;
    expect(document.activeElement).toBe(mark);
    expect(mark.className).toContain('ring-2');
    expect(scroll).toHaveBeenCalled();
  });
});
