const VOICE_GROUP_ORDER = ['Soprano', 'Alto', 'Tenor', 'Bass'];

interface FormatAssignmentScopeLabelOptions {
  targetVoiceGroup?: string | null;
  targetVoiceGroups?: Array<string | null | undefined>;
  allChoirLabel?: string;
  mixedLabel?: string;
}

function normalizeVoiceGroup(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getVoiceGroupSortIndex(voiceGroup: string) {
  const index = VOICE_GROUP_ORDER.indexOf(voiceGroup);
  return index === -1 ? VOICE_GROUP_ORDER.length : index;
}

function getUniqueVoiceGroups(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map(normalizeVoiceGroup).filter((voiceGroup): voiceGroup is string => Boolean(voiceGroup))),
  ).sort((a, b) => {
    const sortIndexCompare = getVoiceGroupSortIndex(a) - getVoiceGroupSortIndex(b);
    if (sortIndexCompare !== 0) {
      return sortIndexCompare;
    }
    return a.localeCompare(b, 'tr');
  });
}

export function formatAssignmentScopeLabel({
  targetVoiceGroup,
  targetVoiceGroups = [],
  allChoirLabel = 'Tüm Koro',
  mixedLabel = 'Karma Partiler',
}: FormatAssignmentScopeLabelOptions) {
  const explicitVoiceGroups = getUniqueVoiceGroups(targetVoiceGroups);
  if (explicitVoiceGroups.length === 1) {
    return `${explicitVoiceGroups[0]} Partisi`;
  }

  if (explicitVoiceGroups.length > 1) {
    const isAllKnownVoiceGroups =
      explicitVoiceGroups.length === VOICE_GROUP_ORDER.length &&
      VOICE_GROUP_ORDER.every((voiceGroup) => explicitVoiceGroups.includes(voiceGroup));

    return isAllKnownVoiceGroups ? allChoirLabel : mixedLabel;
  }

  const fallbackVoiceGroup = normalizeVoiceGroup(targetVoiceGroup);
  if (fallbackVoiceGroup) {
    return `${fallbackVoiceGroup} Partisi`;
  }

  return allChoirLabel;
}
