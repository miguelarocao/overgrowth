// Teams differ by bloom colour AND bloom shape, so they stay distinguishable
// without relying on colour alone. All teams play by the same rules.

export interface TeamDef {
  key: string;
  name: string;
  color: string;
  /** Short description of the bloom silhouette (also used for HUD glyphs). */
  shape: string;
  core: boolean;
}

export const TEAMS: readonly TeamDef[] = [
  { key: 'glory', name: 'Morning glory', color: '#4A86F2', shape: 'trumpet', core: true },
  { key: 'sun', name: 'Sunflower', color: '#F2C230', shape: 'head', core: true },
  { key: 'lav', name: 'Lavender', color: '#A27DF0', shape: 'spike', core: true },
  { key: 'rose', name: 'Rose', color: '#EC4D63', shape: 'round', core: true },
  // Candidates for players 5 to 8.
  { key: 'poppy', name: 'Poppy', color: '#F07A2A', shape: 'cup', core: false },
  { key: 'daisy', name: 'Daisy', color: '#F4F1E8', shape: 'flat', core: false },
  { key: 'cherry', name: 'Cherry blossom', color: '#F5A7C7', shape: 'cluster', core: false },
  { key: 'bell', name: 'Bluebell', color: '#4B3FC9', shape: 'bell', core: false },
  // Players 9 to 12: new hues (magenta, teal, lime, wine) and new silhouettes.
  { key: 'fuchsia', name: 'Fuchsia', color: '#D6339E', shape: 'drop', core: false },
  { key: 'hydrangea', name: 'Hydrangea', color: '#2CB8B0', shape: 'mophead', core: false },
  { key: 'zinnia', name: 'Zinnia', color: '#B5D334', shape: 'pompom', core: false },
  { key: 'dahlia', name: 'Dahlia', color: '#9B2D5A', shape: 'dahlia', core: false }
];

export const TEAM_BY_KEY: Record<string, TeamDef> = Object.fromEntries(TEAMS.map((t) => [t.key, t]));

export function teamColor(key: string | undefined): string {
  return (key && TEAM_BY_KEY[key]?.color) || '#9AA0A3';
}
