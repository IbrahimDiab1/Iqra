import { InjectionToken } from '@angular/core';
import { COPY } from '../ui/copy';

export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  size?: number;
  appProperties?: Record<string, string>;
}

/** 401, or a 403 for an auth reason: the access token is missing, expired or revoked. */
export class DriveAuthError extends Error {}

/** The user's Drive is full. JSON sync can go on; PDF uploads must pause. */
export class DriveQuotaError extends Error {
  constructor() {
    super(COPY.sync.driveFull);
    this.name = 'DriveQuotaError';
  }
}

/** A rate limit, a 429 or a 5xx from Drive. Retry later; the token is fine. */
export class DriveTransientError extends Error {
  constructor(message = 'Drive is busy, try again later') {
    super(message);
    this.name = 'DriveTransientError';
  }
}

/** A Drive step got no answer within its deadline. Retry on a later pass. */
export class DriveTimeoutError extends Error {
  constructor() {
    super('Drive request timed out');
    this.name = 'DriveTimeoutError';
  }
}

export interface DriveAdapter {
  listAppData(): Promise<DriveFileInfo[]>;
  readText(fileId: string): Promise<string>;
  writeAppDataJson(name: string, json: string, fileId?: string): Promise<DriveFileInfo>;
  writeAppDataBlob(name: string, blob: Blob, fileId?: string): Promise<DriveFileInfo>;
  /** Creates Iqra/Books if missing; returns the Books folder id. */
  ensureBooksFolder(): Promise<string>;
  uploadPdf(
    blob: Blob,
    name: string,
    folderId: string,
    bookId: string,
    onProgress?: (fraction: number) => void,
  ): Promise<DriveFileInfo>;
  downloadBlob(fileId: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Blob>;
  /** A 404 counts as success. */
  deleteFile(fileId: string): Promise<void>;
  storageQuota(): Promise<{ limit: number; usage: number }>;
  mediaRequest(fileId: string): { url: string; httpHeaders: Record<string, string> };
}

export const DRIVE_ADAPTER = new InjectionToken<DriveAdapter>('drive');
