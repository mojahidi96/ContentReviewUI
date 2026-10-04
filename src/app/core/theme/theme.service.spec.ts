import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import type { User } from '../auth/auth.models';
import { AuthService } from '../auth/auth.service';
import { TEST_USER, provideTestHttp } from '../../testing/test-providers';
import { ThemeService } from './theme.service';

const OTHER_USER: User = {
  id: 'usr_2',
  fullName: 'Grace Hopper',
  email: 'grace@example.com',
  role: 'author',
};

describe('ThemeService', () => {
  let theme: ThemeService;
  let auth: AuthService;
  let http: HttpTestingController;

  async function signIn(user: User): Promise<void> {
    const result = firstValueFrom(auth.login({ email: user.email, password: 'pw' }));
    http.expectOne('/api/v1/auth/login').flush({ user });
    await result;
    TestBed.tick();
  }

  function setUp(): void {
    TestBed.configureTestingModule({ providers: provideTestHttp() });
    theme = TestBed.inject(ThemeService);
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
  }

  beforeEach(() => localStorage.clear());

  afterEach(() => {
    http.verify();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
  });

  it('restores the last theme used on this device', () => {
    localStorage.setItem('contentReview.theme', 'dark');
    setUp();
    expect(theme.theme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies and remembers a toggle for the signed-in user', async () => {
    setUp();
    await signIn(TEST_USER);
    theme.toggle();
    TestBed.tick();

    expect(theme.theme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem('contentReview.theme.user.usr_1')).toBe('dark');
    expect(localStorage.getItem('contentReview.theme')).toBe('dark');
  });

  it("switches to each user's own saved theme when they sign in", async () => {
    localStorage.setItem('contentReview.theme', 'light');
    localStorage.setItem('contentReview.theme.user.usr_2', 'dark');
    setUp();
    expect(theme.theme()).toBe('light');

    await signIn(OTHER_USER);
    expect(theme.theme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('keeps the current theme for a user with no saved choice', async () => {
    localStorage.setItem('contentReview.theme', 'dark');
    setUp();
    await signIn(TEST_USER);
    expect(theme.theme()).toBe('dark');
    expect(localStorage.getItem('contentReview.theme.user.usr_1')).toBeNull();
  });
});
