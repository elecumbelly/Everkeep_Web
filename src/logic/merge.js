import { ensureSystemSections } from './state.js';

export function getUpdatedAt(item) {
  return item?.updatedAt || item?.createdAt || 0;
}

export function mergeCollection(localItems, remoteItems) {
  const merged = new Map();
  localItems.forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  remoteItems.forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id);
    if (!existing || getUpdatedAt(item) > getUpdatedAt(existing)) {
      merged.set(item.id, item);
    }
  });
  return Array.from(merged.values());
}

export function mergeRemoteState(localState, remoteState) {
  const merged = { ...localState };
  merged.memories = mergeCollection(localState.memories, remoteState.memories || []);
  merged.people = mergeCollection(localState.people, remoteState.people || []);
  merged.places = mergeCollection(localState.places, remoteState.places || []);
  merged.sections = ensureSystemSections(mergeCollection(localState.sections, remoteState.sections || []));
  merged.settings = { ...(remoteState.settings || {}), ...localState.settings };
  merged.flags = { ...localState.flags };
  return merged;
}
