import { HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, type Routes } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ViewportService } from '../../../core/layout/viewport.service';
import { TEST_READER, TEST_USER, provideTestHttp, signIn } from '../../../testing/test-providers';
import { DocumentService } from '../document.service';
import { WorkspaceShell } from './workspace-shell';

// The side panel reads the current URL, so the shell is tested at a real (empty) route.
const ROUTES: Routes = [
  { path: 'workspace', children: [] },
  { path: 'workspace/documents', children: [] },
  { path: 'workspace/history', children: [] },
];

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
      providers: [
        ...provideTestHttp(ROUTES),
        { provide: ViewportService, useValue: { isDesktop } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    signIn(TEST_USER);

    fixture = TestBed.createComponent(WorkspaceShell);
    el = fixture.nativeElement;
    await TestBed.inject(Router).navigateByUrl('/workspace');
    await fixture.whenStable();
    // Authors' model list is loaded when the workspace opens.
    http
      .expectOne('/api/v1/reviews/models')
      .flush({ defaultModel: 'gemini-3.6-flash', models: ['gemini-3.6-flash'] });
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

  describe('navigation', () => {
    const navigateTo = async (url: string) => {
      await TestBed.inject(Router).navigateByUrl(url);
      await fixture.whenStable();
    };
    const modelPicker = () => el.querySelector('app-model-picker');

    it('offers Home (the document list) and no separate Documents or Document item', () => {
      const labels = [...el.querySelectorAll('nav a')].map((a) => a.textContent?.trim());
      expect(labels).toEqual(['Home', 'Review history']);
      expect(el.querySelector('nav a[href="/workspace/documents"]')?.textContent).toContain('Home');
    });

    it('highlights Home on the document list and hides Content Review and the model picker', async () => {
      await navigateTo('/workspace/documents');
      const home = el.querySelector('nav a[href="/workspace/documents"]')!;
      expect(home.getAttribute('aria-current')).toBe('page');
      expect(button('Content Review')).toBeUndefined();
      expect(modelPicker()).toBeNull();
    });

    it('shows Content Review and the model picker only on the open document', async () => {
      expect(button('Content Review')).toBeTruthy();
      expect(modelPicker()).not.toBeNull();
      expect(
        el.querySelector('nav a[href="/workspace/documents"]')?.getAttribute('aria-current'),
      ).toBe('page');
      await navigateTo('/workspace?document=abc');
      expect(button('Content Review')).toBeTruthy();
      await navigateTo('/workspace/history');
      expect(button('Content Review')).toBeUndefined();
      expect(modelPicker()).toBeNull();
      expect(
        el.querySelector('nav a[href="/workspace/history"]')?.getAttribute('aria-current'),
      ).toBe('page');
    });
  });

  it('hides review tools and authoring pages from read-only users', async () => {
    signIn(TEST_READER);
    await fixture.whenStable();
    expect(el.textContent).toContain('Read only');
    expect(button('Content Review')).toBeUndefined();
    expect(el.querySelector('a[href="/workspace/history"]')).toBeNull();
    const home = el.querySelector('nav a[href="/workspace"]');
    expect(home?.textContent).toContain('Home');
    expect(el.querySelector('nav a[href="/workspace/documents"]')).toBeNull();
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
