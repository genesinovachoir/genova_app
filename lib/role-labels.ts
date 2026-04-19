export function getRoleDisplayLabel(role: string, voiceGroup?: string | null, short = false) {
  if (role === 'Şef') {
    return 'Şef';
  }

  if (role === 'Partisyon Şefi') {
    if (short && voiceGroup) {
      const abbr = voiceGroup.trim().substring(0, 3);
      return `${abbr}. Şef.`;
    }
    return voiceGroup ? `${voiceGroup} Şefi` : 'Partisyon Şefi';
  }

  return role;
}
