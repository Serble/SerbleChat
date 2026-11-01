import { useClientOptions } from './context/ClientOptionsContext.jsx';

/**
 * Date and time formatting that follows the user's Date & Time settings.
 *
 * Browsers only expose a language (en-US, en-GB…), not the OS 12/24-hour or
 * date-order preference, so "auto" follows the language and the other choices
 * override it.
 *
 * The preferences live here at module level so plain helpers can use them;
 * ClientOptionsProvider keeps them current. Components that show dates call
 * useDateFormat(), which also re-renders them when a preference changes.
 */

export const TIME_FORMATS = [
  { value: 'auto', label: 'Auto' },
  { value: '12h',  label: '12-hour' },
  { value: '24h',  label: '24-hour' },
];

export const DATE_FORMATS = [
  { value: 'auto',       label: 'Auto' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'DD/MM/YY',   label: 'DD/MM/YY' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'MM/DD/YY',   label: 'MM/DD/YY' },
  { value: 'YYYY/MM/DD', label: 'YYYY/MM/DD' },
];

export const isTimeFormat = v => TIME_FORMATS.some(f => f.value === v);
export const isDateFormat = v => DATE_FORMATS.some(f => f.value === v);

let prefs = { time: 'auto', date: 'auto' };

/** Called by ClientOptionsProvider whenever the settings change. */
export function setDateFormatPrefs(time, date) {
  prefs = { time: isTimeFormat(time) ? time : 'auto', date: isDateFormat(date) ? date : 'auto' };
}

/** A time in a specific format ('auto' | '12h' | '24h'), e.g. for previews in settings. */
export function formatTimeAs(date, format) {
  if (format === '12h') return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  if (format === '24h') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "9:05 PM" / "21:05", per the time setting. */
export function formatTime(date) {
  return formatTimeAs(date, prefs.time);
}

/** "04/11/2026", per the date setting. */
export function formatDate(date) {
  return formatDateAs(date, prefs.date);
}

/** A date in a specific format (a DATE_FORMATS value), e.g. for previews in settings. */
export function formatDateAs(date, p) {
  if (p === 'auto') return date.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' });
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  const yy = yyyy.slice(-2);
  switch (p) {
    case 'DD/MM/YYYY': return `${dd}/${mm}/${yyyy}`;
    case 'DD/MM/YY':   return `${dd}/${mm}/${yy}`;
    case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`;
    case 'MM/DD/YY':   return `${mm}/${dd}/${yy}`;
    case 'YYYY/MM/DD': return `${yyyy}/${mm}/${dd}`;
    default:           return date.toLocaleDateString();
  }
}

/** "04/11/2026 21:05". */
export function formatDateTime(date) {
  return `${formatDate(date)} ${formatTime(date)}`;
}

/**
 * A date written with words, for headings: "Monday, 4 November 2026".
 * Month-first numeric formats give "Monday, November 4, 2026"; the others put the day first.
 * Pass `{ year: false }` to leave the year out.
 */
export function formatDateLong(date, { weekday = true, year = true } = {}) {
  const options = { day: 'numeric', month: 'long', ...(weekday && { weekday: 'long' }), ...(year && { year: 'numeric' }) };
  const p = prefs.date;
  // The app's text is English, so an English locale picks the order without changing the language
  const locale = p === 'auto' ? [] : p.startsWith('MM') ? 'en-US' : 'en-GB';
  return date.toLocaleDateString(locale, options);
}

/**
 * Hook for components that show dates or times: re-renders them when the format
 * settings change and returns the formatters.
 */
export function useDateFormat() {
  const { timeFormat, dateFormat } = useClientOptions();
  return { timeFormat, dateFormat, formatTime, formatDate, formatDateTime, formatDateLong };
}
