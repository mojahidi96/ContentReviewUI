import type { Routes } from '@angular/router';
import { authorGuard } from '../../core/guards/author.guard';
import { unsavedChangesGuard } from '../../core/guards/unsaved-changes.guard';

export const WORKSPACE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./workspace-shell/workspace-shell').then((m) => m.WorkspaceShell),
    children: [
      {
        path: '',
        title: 'Workspace · ContentReview',
        loadComponent: () => import('./document-page/document.page').then((m) => m.DocumentPage),
      },
      {
        path: 'documents',
        canActivate: [authorGuard],
        title: 'Documents · ContentReview',
        loadComponent: () => import('./documents-page/documents.page').then((m) => m.DocumentsPage),
      },
      {
        path: 'documents/:id',
        canActivate: [authorGuard],
        title: 'Document · ContentReview',
        loadComponent: () =>
          import('./document-article-page/document-article.page').then(
            (m) => m.DocumentArticlePage,
          ),
      },
      {
        path: 'write',
        canActivate: [authorGuard],
        canDeactivate: [unsavedChangesGuard],
        title: 'Write · ContentReview',
        loadComponent: () => import('./write-page/write.page').then((m) => m.WritePage),
      },
      {
        path: 'history',
        canActivate: [authorGuard],
        title: 'Review history · ContentReview',
        loadComponent: () =>
          import('../content-review/review-history-page/review-history.page').then(
            (m) => m.ReviewHistoryPage,
          ),
      },
    ],
  },
];
