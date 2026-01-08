export const STORAGE_KEY = 'everkeep:data';
export const DRAFT_KEY = 'everkeep:draft';
export const ONBOARDING_KEY = 'everkeep:onboarding';
export const OWNER_KEY_STORAGE = 'everkeep:ownerKey';
export const EMPTY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8-8-3.6-8-8Z"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>';

export const prompts = {
  gentle: [
    'A quiet moment that felt like enough.',
    'Something small that made today softer.',
    'A sound, scent, or colour you want to keep.',
    'A person who made today lighter.',
    'A tiny win worth holding onto.'
  ],
  curious: [
    'What surprised you in a good way today?',
    'What did you notice that you might normally miss?',
    'What do you want future you to remember?',
    'Where did your attention feel most alive?',
    'What felt worth slowing down for?'
  ],
  quiet: [
    'Name a simple comfort from today.',
    'One kind thing you did for yourself.',
    'A moment that felt steady.',
    'A texture or place you want to hold.',
    'Something you can let be enough.'
  ]
};

export const defaultState = {
  memories: [],
  sections: [
    {
      id: 'sec_my_life',
      name: 'My Life',
      system: true,
      defaultVisibility: 'Private'
    },
    {
      id: 'sec_where_it_began',
      name: 'Where it all began',
      system: true,
      defaultVisibility: 'Private'
    },
    {
      id: 'sec_private_memories',
      name: 'Private Memories',
      system: true,
      defaultVisibility: 'Private'
    }
  ],
  people: [],
  places: [],
  settings: {
    promptStyle: 'gentle',
    revealTimeline: false,
    revealCalendar: false,
    revealTags: false,
    revealKeepsakes: false,
    revealMap: false,
    cloudSync: false,
    reducedMotion: false
  },
  flags: {
    timelineNudgeShown: false,
    calendarNudgeShown: false,
    tagsNudgeShown: false,
    keepsakesNudgeShown: false
  }
};
