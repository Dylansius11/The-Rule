export const TEAM_NAME_HINT = 'Use 3–24 ASCII lowercase letters, digits or hyphens.';
export const validTeamName = (name: string) =>
  name.length >= 3 && name.length <= 24 && !/[^a-z0-9-]/.test(name);
