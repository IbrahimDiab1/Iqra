import { DestroyRef, ViewContainerRef } from '@angular/core';

/**
 * Loads the intro's code on first need and shows it next to `host`. It removes itself when closed.
 * (Done by hand instead of `@defer`, which would add Angular's defer runtime to the initial bundle.)
 */
export async function openIntro(host: ViewContainerRef, owner: DestroyRef, onAddBook: () => void): Promise<void> {
  let gone = false;
  owner.onDestroy(() => (gone = true));
  let OnboardingSheet: typeof import('./onboarding.sheet').OnboardingSheet;
  try {
    OnboardingSheet = await import('./onboarding.sheet').then((m) => m.OnboardingSheet);
  } catch (err) {
    console.warn('Could not load the intro', err); // Offline after a deploy: the intro is optional.
    return;
  }
  // The page may have been left while the code was loading.
  if (gone) return;
  const ref = host.createComponent(OnboardingSheet);
  ref.setInput('open', true);
  const closed = ref.instance.closed.subscribe(() => {
    closed.unsubscribe();
    adds.unsubscribe();
    ref.destroy();
  });
  const adds = ref.instance.addBookRequested.subscribe(onAddBook);
}
