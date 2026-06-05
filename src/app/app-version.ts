import versionFile from '../../version.json';

export const APP_VERSION = normalizeVersion((versionFile as {version?: string}).version);
export const APP_VERSION_LABEL = APP_VERSION ? `V.${APP_VERSION}` : 'Unavailable';
export const APP_TITLE_VERSION = shortVersion(APP_VERSION);
export const APP_WINDOW_TITLE = APP_TITLE_VERSION ? `League Profile Tool ${APP_TITLE_VERSION}` : 'League Profile Tool';

export function normalizeVersion(value: string): string {
  const match = /(\d+(?:\.\d+){0,2})/.exec(String(value || ''));
  if (!match) return '';

  const parts = match[1].split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).join('.');
}

export function shortVersion(version: string): string {
  const normalized = normalizeVersion(version);
  return normalized ? normalized.split('.').slice(0, 2).join('.') : '';
}
