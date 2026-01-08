import { capitalise } from './utils.js';

export function getMemoryDate(memory) {
  if (memory.date?.type === 'exact' && memory.date.value) return new Date(memory.date.value);
  if (memory.date?.type === 'month' && memory.date.value) return new Date(`${memory.date.value}-01`);
  if (memory.date?.type === 'season' && memory.date.year) return new Date(`${memory.date.year}-01-01`);
  return new Date(memory.createdAt);
}

export function formatDateLabel(memory) {
  if (!memory.date) return new Date(memory.createdAt).toLocaleDateString('en-GB');
  if (memory.date.type === 'exact' && memory.date.value) {
    return new Date(memory.date.value).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }
  if (memory.date.type === 'month' && memory.date.value) {
    const date = new Date(`${memory.date.value}-01`);
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  if (memory.date.type === 'season') {
    const year = memory.date.year ? ` ${memory.date.year}` : '';
    return `${capitalise(memory.date.season)}${year}`;
  }
  if (memory.date.type === 'unknown') return 'Date unknown';
  return new Date(memory.createdAt).toLocaleDateString('en-GB');
}
