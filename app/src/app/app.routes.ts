import { Routes } from '@angular/router';
import { signedInGuard, signedOutGuard } from './auth/auth.guard';
import { LibraryPage } from './pages/library/library.page';

export const routes: Routes = [
  { path: '', redirectTo: 'library', pathMatch: 'full' },
  { path: 'welcome', loadComponent: () => import('./pages/welcome.component').then((m) => m.WelcomePage), canActivate: [signedOutGuard] },
  { path: 'library', component: LibraryPage, canActivate: [signedInGuard] },
  { path: 'notes', loadComponent: () => import('./notes/notes.page').then((m) => m.NotesPage), canActivate: [signedInGuard] },
  { path: 'stats', loadComponent: () => import('./stats/stats.page').then((m) => m.StatsPage), canActivate: [signedInGuard] },
  { path: 'read/:bookId', loadComponent: () => import('./reader/reader.page').then((m) => m.ReaderPage), canActivate: [signedInGuard] },
  { path: '**', redirectTo: 'library' },
];
