import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book } from '../core/models';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { FakeDrive } from '../sync/fake-drive';
import { COPY } from '../ui/copy';
import { FilesService } from './files.service';
import { RemoveBookSheetComponent } from './remove-book.sheet';

function book(driveFileId: string): Book {
  return { id: 'b1', title: 'T', driveFileId } as Book;
}

describe('RemoveBookSheetComponent', () => {
  async function render(b: Book): Promise<HTMLElement> {
    const db = new IqraDb(`iqra-test-${newId()}`);
    await db.pdfFiles.put({ bookId: b.id, blob: new Blob(['x']), sizeBytes: 1, savedAt: 1 });
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: DRIVE_ADAPTER, useValue: new FakeDrive() },
        { provide: AuthApi, useClass: FakeAuthService },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
    const files = TestBed.inject(FilesService);
    const fixture = TestBed.createComponent(RemoveBookSheetComponent);
    files.requestRemove(b);
    // Wait for the live downloaded-ids query to deliver.
    await vi.waitFor(() => expect(files.downloaded().has(b.id)).toBe(true));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('hides Remove from this device and shows the hint while the upload is pending', async () => {
    const el = await render(book(''));
    expect(el.textContent).not.toContain(COPY.remove.device);
    expect(el.textContent).toContain(COPY.remove.stillUploading);
  });

  it('offers Remove from this device once the book is on Drive', async () => {
    const el = await render(book('file-1'));
    expect(el.textContent).toContain(COPY.remove.device);
    expect(el.textContent).not.toContain(COPY.remove.stillUploading);
  });
});
