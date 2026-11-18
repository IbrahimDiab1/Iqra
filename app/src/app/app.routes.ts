import { Routes } from '@angular/router';
import { signedInGuard, signedOutGuard } from './auth/auth.guard';
import { ComingSoonPage } from './pages/coming-soon.component';
import { LibraryPage } from './pages/library/library.page';
import { COPY } from './ui/copy';

export const routes: Routes = [
  { path: '', redirectTo: 'library', pathMatch: 'full' },
  { path: 'welcome', loadComponent: () => import('./pages/welcome.component').then((m) => m.WelcomePage), canActivate: [signedOutGuard] },
  { path: 'library', component: LibraryPage, canActivate: [signedInGuard] },
  { path: 'notes', component: ComingSoonPage, canActivate: [signedInGuard], data: { icon: 'notes', title: COPY.placeholder.notesTitle, text: COPY.placeholder.notesText, next: COPY.placeholder.notesNext } },
  { path: 'stats', component: ComingSoonPage, canActivate: [signedInGuard], data: { icon: 'stats', title: COPY.placeholder.statsTitle, text: COPY.placeholder.statsText, next: COPY.placeholder.statsNext } },
  { path: 'read/:bookId', loadComponent: () => import('./reader/reader.page').then((m) => m.ReaderPage), canActivate: [signedInGuard] },
  { path: '**', redirectTo: 'library' },
];
