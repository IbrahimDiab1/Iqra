import { Routes } from '@angular/router';
import { signedInGuard, signedOutGuard } from './auth/auth.guard';
import { LibraryPage } from './pages/library/library.page';

export const routes: Routes = [
  { path: '', redirectTo: 'library', pathMatch: 'full' },
  { path: 'welcome', loadComponent: () => import('./pages/welcome.component').then((m) => m.WelcomePage), canActivate: [signedOutGuard] },
  { path: 'library', component: LibraryPage, canActivate: [signedInGuard] },
  { path: 'notes', loadComponent: () => import('./notes/notes.page').then((m) => m.NotesPage), canActivate: [signedInGuard] },
  { path: 'review', loadComponent: () => import('./review/review.page').then((m) => m.ReviewPage), canActivate: [signedInGuard] },
  { path: 'stats', loadComponent: () => import('./stats/stats.page').then((m) => m.StatsPage), canActivate: [signedInGuard] },
  { path: 'profile', loadComponent: () => import('./profile/profile.page').then((m) => m.ProfilePage), canActivate: [signedInGuard] },
  { path: 'settings', redirectTo: 'profile', pathMatch: 'full' },
  { path: 'profile/downloads', loadComponent: () => import('./settings/downloads.page').then((m) => m.DownloadsPage), canActivate: [signedInGuard] },
  { path: 'settings/downloads', redirectTo: 'profile/downloads', pathMatch: 'full' },
  { path: 'read/:bookId', loadComponent: () => import('./reader/reader.page').then((m) => m.ReaderPage), canActivate: [signedInGuard] },
  { path: '**', redirectTo: 'library' },
];
