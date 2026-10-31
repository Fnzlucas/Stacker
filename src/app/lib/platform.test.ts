import { describe, expect, it } from 'vitest';
import { canSuggestIosInstall, isIos, isNativeApp, type PlatformEnv } from './platform';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

const env = (over: Partial<PlatformEnv> = {}): PlatformEnv => ({ userAgent: SAFARI, maxTouchPoints: 5, standalone: false, capacitor: undefined, ...over });

describe('plateforme', () => {
  it('iPhone dans Safari : on propose l’installation', () => {
    expect(isIos(env())).toBe(true);
    expect(canSuggestIosInstall(env())).toBe(true);
  });
  it('déjà installée, application native, autre navigateur ou autre appareil : rien', () => {
    expect(canSuggestIosInstall(env({ standalone: true }))).toBe(false);
    expect(canSuggestIosInstall(env({ capacitor: { isNativePlatform: () => true } }))).toBe(false);
    expect(canSuggestIosInstall(env({ userAgent: CHROME_IOS }))).toBe(false);
    expect(canSuggestIosInstall(env({ userAgent: ANDROID }))).toBe(false);
    expect(isIos(env({ userAgent: IPAD_DESKTOP, maxTouchPoints: 5 }))).toBe(true);
    expect(isIos(env({ userAgent: IPAD_DESKTOP, maxTouchPoints: 0 }))).toBe(false);
  });
  it('application native détectée, sans exception', () => {
    expect(isNativeApp(env({ capacitor: { isNativePlatform: () => true } }))).toBe(true);
    expect(isNativeApp(env())).toBe(false);
    expect(
      isNativeApp(
        env({
          capacitor: {
            isNativePlatform: () => {
              throw new Error('x');
            },
          },
        }),
      ),
    ).toBe(false);
  });
});
