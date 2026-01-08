import { EMPTY_ICON } from '../data/defaults.js';

export function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

export function capitalise(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function escapeHtml(value) {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emptyStateHTML(message) {
  return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">${EMPTY_ICON}</div><p>${escapeHtml(message)}</p></div>`;
}
