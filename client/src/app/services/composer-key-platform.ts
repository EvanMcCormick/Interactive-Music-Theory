import { InjectionToken } from '@angular/core';

/**
 * Whose names a shortcut's modifiers are written with: a Mac's ⌘ and ⌥, or Ctrl and Alt everywhere else.
 *
 * Matching does not need it - `bindingMatches` reads Cmd as Ctrl on every platform - but a label does: a Mac user
 * reading "Ctrl+Z" presses Control, which is not undo in any other Mac app. So the tooltips and the shortcut sheet
 * write the modifiers the keyboard in front of the user has.
 */
export type KeyPlatform = 'mac' | 'other';

/** The parts of `navigator` read. `userAgentData` is Chromium's, and not in TypeScript's DOM types. */
export interface PlatformSource {
  platform?: string;
  userAgentData?: { platform?: string };
}

/**
 * The platform `source` reports: a Mac, or an iPhone or iPad, whose hardware keyboards have ⌘ too - or anything else.
 * `userAgentData.platform` first, where a Chromium browser has it, since `navigator.platform` is deprecated and may be
 * frozen; `navigator.platform` otherwise, which Firefox and Safari still fill in. An empty string is no answer, so it
 * falls through (`||`, not `??`).
 */
export function keyPlatformOf(source: PlatformSource | null): KeyPlatform {
  const platform = source?.userAgentData?.platform || source?.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform) ? 'mac' : 'other';
}

/** The platform this browser runs on, read once. Provided so a spec can give a component either one. */
export const KEY_PLATFORM = new InjectionToken<KeyPlatform>('KEY_PLATFORM', {
  providedIn: 'root',
  factory: () => keyPlatformOf(typeof navigator === 'undefined' ? null : navigator)
});
