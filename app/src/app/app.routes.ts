import { Routes } from '@angular/router';
import { signedInGuard, signedOutGuard } from './auth/auth.guard';
import { ComingSoonPage } from './pages/coming-soon.component';
import { LibraryPage } from './pages/library/library.page';
import { ReaderStubPage } from './reader/reader-stub.page';
import { WelcomePage } from './pages/welcome.component';

export const routes: Routes = [
  { path: '', redirectTo: 'library', pathMatch: 'full' },
  { path: 'welcome', component: WelcomePage, canActivate: [signedOutGuard] },
  { path: 'library', component: LibraryPage, canActivate: [signedInGuard] },
  { path: 'notes', component: ComingSoonPage, canActivate: [signedInGuard] },
  { path: 'stats', component: ComingSoonPage, canActivate: [signedInGuard] },
  { path: 'read/:bookId', component: ReaderStubPage, canActivate: [signedInGuard] },
  { path: '**', redirectTo: 'library' },
];
