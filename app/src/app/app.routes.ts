import { Routes } from '@angular/router';
import { ComingSoonPage } from './pages/coming-soon.component';
import { LibraryPage } from './pages/library.component';
import { ReadPage } from './pages/read.component';
import { WelcomePage } from './pages/welcome.component';

export const routes: Routes = [
  { path: '', redirectTo: 'library', pathMatch: 'full' },
  { path: 'welcome', component: WelcomePage },
  { path: 'library', component: LibraryPage },
  { path: 'notes', component: ComingSoonPage },
  { path: 'stats', component: ComingSoonPage },
  { path: 'read/:bookId', component: ReadPage },
  { path: '**', redirectTo: 'library' },
];
