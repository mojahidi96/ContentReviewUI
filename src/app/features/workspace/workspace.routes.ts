import type { Routes } from '@angular/router';
import { authorGuard } from '../../core/guards/author.guard';

export const WORKSPACE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./workspace-shell').then((m) => m.WorkspaceShell),
    children: [
      {
        path: '',
        title: 'Workspace · ContentReview',
        loadComponent: () => import('./document.page').then((m) => m.DocumentPage),
      },
      {
        path: 'history',
        canActivate: [authorGuard],
        title: 'Review history · ContentReview',
        loadComponent: () =>
          import('../content-review/review-history.page').then((m) => m.ReviewHistoryPage),
      },
    ],
  },
];
