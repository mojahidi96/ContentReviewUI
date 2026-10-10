import type { Routes } from '@angular/router';
import { guestGuard } from '../../core/guards/guest.guard';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in · ContentReview',
    loadComponent: () => import('./login-page/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    title: 'Create account · ContentReview',
    loadComponent: () => import('./register-page/register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'login/code',
    canActivate: [guestGuard],
    title: 'Sign in with a code · ContentReview',
    data: { mode: 'login' },
    loadComponent: () => import('./otp-page/otp.page').then((m) => m.OtpPage),
  },
  {
    path: 'forgot-password',
    canActivate: [guestGuard],
    title: 'Reset password · ContentReview',
    data: { mode: 'reset' },
    loadComponent: () => import('./otp-page/otp.page').then((m) => m.OtpPage),
  },
];
