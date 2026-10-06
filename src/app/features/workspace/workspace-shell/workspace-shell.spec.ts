import { HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ViewportService } from '../../../core/layout/viewport.service';
import { TEST_READER, TEST_USER, provideTestHttp, signIn } from '../../../testing/test-providers';
import { DocumentService } from '../document.service';
import { WorkspaceShell } from './workspace-shell';

describe('WorkspaceShell', () => {
  let fixture: ComponentFixture<WorkspaceShell>;
  let el: HTMLElement;
  let http: HttpTestingController;
  const isDesktop = signal(true);

  const button = (label: string) =>
    [...el.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === label || b.textContent?.trim().startsWith(label),
    )!;
  const sidebar = () => el.querySelector<HTMLElement>('#workspace-sidebar')!;
  const pressEscape = async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    localStorage.clear();
    isDesktop.set(true);
    TestBed.configureTestingModule({
      imports: [WorkspaceShell],
      providers: [...provideTestHttp(), { provide: ViewportService, useValue: { isDesktop } }],
    });
    http = TestBed.inject(HttpTestingController);
    signIn(TEST_USER);

    fixture = TestBed.createComponent(WorkspaceShell);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('shows the signed-in user and the Content Review action', () => {
    expect(el.textContent).toContain('Ada Lovelace');
    expect(el.textContent).toContain('ada@example.com');
    expect(button('Content Review')).toBeTruthy();
  });

  it('labels authors and offers the authoring tools', () => {
    expect(el.textContent).toContain('Author');
    expect(el.querySelector('a[href="/workspace/history"]')).not.toBeNull();
  });

  it('hides review tools and authoring pages from read-only users', async () => {
    signIn(TEST_READER);
    await fixture.whenStable();
    expect(el.textContent).toContain('Read only');
    expect(button('Content Review')).toBeUndefined();
    expect(el.querySelector('a[href="/workspace/history"]')).toBeNull();
    expect(el.querySelector('a[href="/workspace"]')).not.toBeNull();
  });

  describe('desktop sidebar', () => {
    it('collapses to an icon rail, keeps accessible labels and remembers the choice', async () => {
      const toggle = button('Collapse sidebar');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(sidebar().className).toContain('w-64');

      toggle.click();
      await fixture.whenStable();

      expect(button('Expand sidebar').getAttribute('aria-expanded')).toBe('false');
      expect(sidebar().className).toContain('w-16');
      expect(button('Content Review').getAttribute('aria-label')).toBe('Content Review');
      expect(el.querySelector('a[aria-label="Review history"]')).not.toBeNull();
      expect(localStorage.getItem('contentReview.sidebarCollapsed')).toBe('true');
    });

    it('is never inert', () => {
      expect(sidebar().hasAttribute('inert')).toBe(false);
    });
  });

  describe('mobile drawer', () => {
    beforeEach(async () => {
      isDesktop.set(false);
      await fixture.whenStable();
    });

    it('starts closed and inert so hidden links cannot be tabbed to', () => {
      expect(sidebar().hasAttribute('inert')).toBe(true);
      expect(button('Open navigation').getAttribute('aria-expanded')).toBe('false');
      expect(el.textContent).not.toContain('Collapse');
    });

    it('opens, then closes on Escape and returns focus to the menu button', async () => {
      const menu = button('Open navigation');
      menu.click();
      await fixture.whenStable();
      expect(menu.getAttribute('aria-expanded')).toBe('true');
      expect(sidebar().hasAttribute('inert')).toBe(false);
      expect(sidebar().contains(document.activeElement)).toBe(true);

      await pressEscape();
      expect(menu.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(menu);
    });
  });

  it('starts a review from the side panel and shows progress', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    // The shell owns its document state; the sample exceeds the test config's 100-char limit.
    fixture.debugElement.injector.get(DocumentService).setContent('Short text with a typo: teh.');
    button('Content Review').click();
    await fixture.whenStable();
    const req = http.expectOne({ method: 'POST', url: '/api/v1/reviews' });
    expect(req.request.body.content).toBe('Short text with a typo: teh.');
    expect(el.textContent).toContain('Reviewing…');
    req.flush(null, { status: 503, statusText: 'Unavailable' });
  });

  it('logs out', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    button('Sign out').click();
    http.expectOne('/api/v1/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});
