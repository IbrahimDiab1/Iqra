import { Injectable, signal } from '@angular/core';
import { AuthApi, AuthState, Profile } from './auth.service';

const FAKE_PROFILE: Profile = { name: 'Test User', email: 'reader@example.test' };

/** In-memory AuthApi for tests and e2e runs. Nothing is stored between page loads. */
@Injectable()
export class FakeAuthService extends AuthApi {
  private readonly stateSignal = signal<AuthState>('signed-out');
  private readonly profileSignal = signal<Profile | null>(null);
  readonly state = this.stateSignal.asReadonly();
  readonly profile = this.profileSignal.asReadonly();

  token(): string | null {
    return this.stateSignal() === 'signed-in' ? 'fake-token' : null;
  }

  async signIn(): Promise<void> {
    this.profileSignal.set(FAKE_PROFILE);
    this.stateSignal.set('signed-in');
  }

  async reconnect(): Promise<void> {
    this.stateSignal.set('signed-in');
  }

  async trySilent(): Promise<boolean> {
    if (!this.profileSignal()) return false;
    this.stateSignal.set('signed-in');
    return true;
  }

  private readonly scopes = new Set<string>();

  scopeToken(scope: string): string | null {
    return this.scopes.has(scope) ? 'fake-scope-token' : null;
  }

  async requestScope(scope: string): Promise<string> {
    this.scopes.add(scope);
    return 'fake-scope-token';
  }

  signOut(): void {
    this.scopes.clear();
    this.profileSignal.set(null);
    this.stateSignal.set('signed-out');
  }

  preload(): void {}

  markExpired(): void {
    if (this.profileSignal()) this.stateSignal.set('expired');
  }
}
