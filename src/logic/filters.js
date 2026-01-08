import { getMemoryDate } from './dates.js';
import { getPlaceName } from './places.js';

export function applyFilters(memories, filters, people, places) {
  const query = filters.search.toLowerCase();
  const now = new Date();
  return memories
    .filter((memory) => {
      const peopleIds = memory.peopleIds || [];
      const tags = memory.tags || [];
      if (filters.section !== 'all' && memory.sectionId !== filters.section) return false;
      if (filters.visibility !== 'all' && memory.visibility.type !== filters.visibility) return false;
      if (filters.tag !== 'all' && !tags.includes(filters.tag)) return false;
      if (filters.person !== 'all' && !peopleIds.includes(filters.person)) return false;
      if (filters.place !== 'all' && memory.placeId !== filters.place) return false;

      const date = getMemoryDate(memory);
      if (filters.date === 'last7') {
        const cutoff = new Date(now);
        cutoff.setDate(now.getDate() - 7);
        if (date < cutoff) return false;
      }
      if (filters.date === 'last30') {
        const cutoff = new Date(now);
        cutoff.setDate(now.getDate() - 30);
        if (date < cutoff) return false;
      }
      if (filters.date === 'year') {
        if (date.getFullYear() !== now.getFullYear()) return false;
      }

      if (!query) return true;
      const content = [memory.title, memory.body, memory.lowEnergyLine, ...tags]
        .join(' ')
        .toLowerCase();
      const peopleNames = peopleIds
        .map((id) => people.find((person) => person.id === id)?.name)
        .join(' ')
        .toLowerCase();
      const placeName = getPlaceName(places, memory.placeId).toLowerCase();
      return [content, peopleNames, placeName].some((text) => text.includes(query));
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}
