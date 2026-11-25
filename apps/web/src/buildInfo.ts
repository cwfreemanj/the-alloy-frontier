/**
 * Which build this is (set by vite.config.ts at build time), so playtest notes, bug reports and
 * performance reports can name the exact version (GDD 8.5: a versioned build).
 */
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;

export const BUILD = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev',
  date: typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '',
};

/** "v0.1.0 (abc1234, 2026-11-25)". */
export const buildLabel = (): string => `v${BUILD.version} (${BUILD.sha}${BUILD.date ? `, ${BUILD.date}` : ''})`;
