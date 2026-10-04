import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';

/** Keeps read-only users out of authoring pages by sending them to the document view. */
export const authorGuard: CanActivateFn = () =>
  inject(AuthService).canEdit() || inject(Router).createUrlTree(['/workspace']);
