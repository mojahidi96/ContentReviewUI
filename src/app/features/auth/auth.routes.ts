import type { Routes } from '@angular/router';
import { guestGuard } from '../../core/guards/guest.guard';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in · ContentReview',
    loadComponent: () => import('./login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    title: 'Create account · ContentReview',
    loadComponent: () => import('./register.page').then((m) => m.RegisterPage),
  },
];
