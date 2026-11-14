import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
