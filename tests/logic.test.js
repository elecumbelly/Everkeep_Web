import { describe, it, expect } from 'vitest';
import { defaultState } from '../src/data/defaults.js';
import { formatDateLabel, getMemoryDate } from '../src/logic/dates.js';
import { applyFilters } from '../src/logic/filters.js';
import { mergeCollection, mergeRemoteState } from '../src/logic/merge.js';
import { normaliseState } from '../src/logic/state.js';
import { getAllTags, parseTags } from '../src/logic/tags.js';
import { emptyStateHTML, escapeHtml } from '../src/logic/utils.js';

describe('normaliseState', () => {
  it('fills missing memory fields and defaults', () => {
    const raw = {
      sections: [{ id: 'sec_custom', name: 'Custom', system: 0 }],
      memories: [{ id: 'mem_1', createdAt: 1 }]
    };
    const result = normaliseState(raw);
    const memory = result.memories[0];
    expect(memory.peopleIds).toEqual([]);
    expect(memory.tags).toEqual([]);
    expect(memory.media).toEqual([]);
    expect(memory.visibility).toEqual({ type: 'Private', peopleIds: [] });
    expect(memory.sectionId).toBe(defaultState.sections[0].id);
    expect(result.settings.promptStyle).toBe(defaultState.settings.promptStyle);
    expect(result.flags.timelineNudgeShown).toBe(false);
    expect(result.sections[0].system).toBe(false);
    expect(result.sections[0].defaultVisibility).toBe('Private');
  });
});

describe('tags', () => {
  it('parses tags with trimming and dedupe', () => {
    expect(parseTags('  hello, world, hello, , ')).toEqual(['hello', 'world']);
  });

  it('collects and sorts unique tags', () => {
    const tags = getAllTags([
      { tags: ['b', 'a'] },
      { tags: ['b', 'c'] }
    ]);
    expect(tags).toEqual(['a', 'b', 'c']);
  });
});

describe('dates', () => {
  it('creates dates from month values', () => {
    const date = getMemoryDate({ date: { type: 'month', value: '2024-05' }, createdAt: 0 });
    expect(date.getUTCFullYear()).toBe(2024);
    expect(date.getUTCMonth()).toBe(4);
  });

  it('formats season and unknown dates', () => {
    expect(formatDateLabel({ date: { type: 'season', season: 'spring', year: 2020 }, createdAt: 0 }))
      .toBe('Spring 2020');
    expect(formatDateLabel({ date: { type: 'unknown' }, createdAt: 0 }))
      .toBe('Date unknown');
  });
});

describe('merge', () => {
  it('prefers newer items in mergeCollection', () => {
    const local = [{ id: '1', updatedAt: 10, value: 'local' }];
    const remote = [{ id: '1', updatedAt: 20, value: 'remote' }];
    expect(mergeCollection(local, remote)[0].value).toBe('remote');
  });

  it('merges remote state and preserves local settings priority', () => {
    const localState = {
      memories: [],
      people: [],
      places: [],
      sections: defaultState.sections.slice(0, 2),
      settings: { ...defaultState.settings, promptStyle: 'gentle' },
      flags: { ...defaultState.flags }
    };
    const remoteState = {
      memories: [],
      people: [],
      places: [],
      sections: [],
      settings: { promptStyle: 'quiet', revealCalendar: true }
    };
    const merged = mergeRemoteState(localState, remoteState);
    expect(merged.settings.promptStyle).toBe('gentle');
    expect(merged.settings.revealCalendar).toBe(true);
    const mergedIds = merged.sections.map((section) => section.id).sort();
    const defaultIds = defaultState.sections.map((section) => section.id).sort();
    expect(mergedIds).toEqual(defaultIds);
  });
});

describe('filters', () => {
  it('filters by search across place names', () => {
    const memories = [
      {
        id: 'm1',
        title: 'Trip',
        body: 'London',
        tags: ['travel'],
        peopleIds: ['p1'],
        placeId: 'pl1',
        visibility: { type: 'Private' },
        sectionId: 'sec',
        createdAt: 2
      },
      {
        id: 'm2',
        title: 'Dinner',
        body: '',
        tags: ['food'],
        peopleIds: [],
        placeId: null,
        visibility: { type: 'Private' },
        sectionId: 'sec',
        createdAt: 1
      }
    ];
    const filters = {
      search: 'paris',
      section: 'all',
      visibility: 'all',
      tag: 'all',
      person: 'all',
      place: 'all',
      date: 'any'
    };
    const people = [{ id: 'p1', name: 'Alex' }];
    const places = [{ id: 'pl1', name: 'Paris' }];
    const result = applyFilters(memories, filters, people, places);
    expect(result.map((memory) => memory.id)).toEqual(['m1']);
  });
});

describe('escapeHtml', () => {
  it('escapes HTML in emptyStateHTML output', () => {
    const output = emptyStateHTML('<script>');
    expect(output).toContain(escapeHtml('<script>'));
  });
});
