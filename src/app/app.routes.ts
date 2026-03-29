import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home').then((m) => m.HomePage),
  },
  {
    path: '**',
    loadComponent: () => import('./pages/chapter-viewer').then((m) => m.ChapterViewerPage),
  },
];
