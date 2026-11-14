import { InjectionToken } from '@angular/core';

export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  size?: number;
  appProperties?: Record<string, string>;
}

/** 401/403 from Drive: the access token is missing, expired or revoked. */
export class DriveAuthError extends Error {}

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
