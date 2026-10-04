import type { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { AUTH_ROUTES } from './features/auth/auth.routes';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'workspace' },
  ...AUTH_ROUTES,
  {
    path: 'workspace',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/workspace/workspace.routes').then((m) => m.WORKSPACE_ROUTES),
  },
  { path: '**', redirectTo: 'workspace' },
];
