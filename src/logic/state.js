import { defaultState } from '../data/defaults.js';

export function normaliseState(rawState) {
  const stored = rawState || {};
  return {
    ...defaultState,
    ...stored,
    sections: (stored.sections || defaultState.sections).map((section) => ({
      ...section,
      system: Boolean(section.system),
      defaultVisibility: section.defaultVisibility || 'Private',
      createdAt: section.createdAt || section.updatedAt || 0,
      updatedAt: section.updatedAt || section.createdAt || 0
    })),
    people: (stored.people || []).map((person) => ({
      ...person,
      createdAt: person.createdAt || person.updatedAt || 0,
      updatedAt: person.updatedAt || person.createdAt || 0
    })),
    places: (stored.places || []).map((place) => ({
      ...place,
      createdAt: place.createdAt || place.updatedAt || 0,
      updatedAt: place.updatedAt || place.createdAt || 0
    })),
    memories: (stored.memories || []).map((memory) => ({
      ...memory,
      peopleIds: memory.peopleIds || [],
      tags: memory.tags || [],
      media: memory.media || [],
      visibility: memory.visibility || { type: 'Private', peopleIds: [] },
      date: memory.date || { type: 'exact', value: '' },
      sectionId: memory.sectionId || defaultState.sections[0].id
    })),
    settings: { ...defaultState.settings, ...(stored.settings || {}) },
    flags: { ...defaultState.flags, ...(stored.flags || {}) }
  };
}

export function ensureSystemSections(sections) {
  const merged = new Map(sections.map((section) => [section.id, section]));
  defaultState.sections.forEach((section) => {
    if (!merged.has(section.id)) {
      merged.set(section.id, section);
    }
  });
  return Array.from(merged.values());
}
