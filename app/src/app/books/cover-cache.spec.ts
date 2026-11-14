import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book } from '../core/models';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { FakeDrive } from '../sync/fake-drive';
import { CoverCache } from './cover-cache';

describe('CoverCache', () => {
  let db: IqraDb;
  let drive: FakeDrive;
  let auth: FakeAuthService;
  let covers: CoverCache;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:cover');
    drive = new FakeDrive();
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useFactory: () => new IqraDb(`iqra-test-${newId()}`) },
        { provide: DRIVE_ADAPTER, useValue: drive },
        { provide: AuthApi, useClass: FakeAuthService },
      ],
    });
    db = TestBed.inject(DB);
    auth = TestBed.inject(AuthApi) as FakeAuthService;
    covers = TestBed.inject(CoverCache);
  });

  afterEach(async () => {
    await db.delete();
  });

  const bookWith = (id: string, coverFileId?: string): Book => ({ id, coverFileId }) as Book;

  it('uses the cover stored on this device without downloading it', async () => {
    await db.covers.put({ bookId: 'local', blob: new Blob(['jpeg']) });
    const download = vi.spyOn(drive, 'downloadBlob');

    const url = covers.get(bookWith('local'));

    await vi.waitFor(() => expect(url()).toBe('blob:cover'));
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads a cover from Drive once and keeps it in the database', async () => {
    const info = await drive.writeAppDataBlob('cover-remote.jpg', new Blob(['jpeg']));
    await auth.signIn();
    const download = vi.spyOn(drive, 'downloadBlob');

    const url = covers.get(bookWith('remote', info.id));

    await vi.waitFor(() => expect(url()).toBe('blob:cover'));
    expect(await db.covers.get('remote')).toBeDefined();
    covers.get(bookWith('remote', info.id));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('stays empty when signed out and the cover is not on this device', async () => {
    const info = await drive.writeAppDataBlob('cover-remote.jpg', new Blob(['jpeg']));

    const url = covers.get(bookWith('remote', info.id));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(url()).toBeNull();
    expect(await db.covers.get('remote')).toBeUndefined();
  });
});
