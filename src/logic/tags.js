export function parseTags(value) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, arr) => arr.indexOf(tag) === index);
}

export function getAllTags(memories) {
  const tags = new Set();
  memories.forEach((memory) => {
    (memory.tags || []).forEach((tag) => tags.add(tag));
  });
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}
