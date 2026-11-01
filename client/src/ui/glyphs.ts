// Small SVG glyphs for each team's bloom shape, so the HUD never relies on colour alone.
import { TEAM_BY_KEY } from '../../../shared/teams';

export function glyph(team: string, size = 18): string {
  const t = TEAM_BY_KEY[team];
  const c = t?.color ?? '#999';
  const s = `width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"`;
  switch (t?.shape) {
    case 'trumpet':
      return `<svg ${s}><path d="M10 2 L17 9 Q10 19 3 9 Z" fill="${c}"/><circle cx="10" cy="9" r="2.6" fill="#F6F1DC"/></svg>`;
    case 'head':
      return `<svg ${s}><g fill="${c}">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<ellipse cx="10" cy="3.6" rx="2.2" ry="3.4" transform="rotate(${a} 10 10)"/>`).join('')}</g><circle cx="10" cy="10" r="3.6" fill="#5A3A12"/></svg>`;
    case 'spike':
      return `<svg ${s}><rect x="9.3" y="8" width="1.4" height="11" fill="#6E8B5E"/><g fill="${c}">${[2, 5, 8, 11].map((y) => `<ellipse cx="10" cy="${y}" rx="2.4" ry="2"/>`).join('')}</g></svg>`;
    case 'round':
      return `<svg ${s}><circle cx="10" cy="10" r="7.5" fill="${c}"/><circle cx="10" cy="10" r="3" fill="#8E1A2E"/></svg>`;
    case 'cup':
      return `<svg ${s}><path d="M3 6 Q10 3 17 6 L14.5 15 Q10 18 5.5 15 Z" fill="${c}"/><circle cx="10" cy="7.5" r="2.2" fill="#2A1A12"/></svg>`;
    case 'flat':
      return `<svg ${s}><g fill="${c}" stroke="#8A8578" stroke-width="0.6">${[0, 40, 80, 120, 160, 200, 240, 280, 320].map((a) => `<ellipse cx="10" cy="4" rx="1.8" ry="3.6" transform="rotate(${a} 10 10)"/>`).join('')}</g><circle cx="10" cy="10" r="2.8" fill="#E8B830"/></svg>`;
    case 'cluster':
      return `<svg ${s}><g fill="${c}"><circle cx="7" cy="7" r="3.6"/><circle cx="13.5" cy="8" r="3.6"/><circle cx="10" cy="13.5" r="3.6"/></g></svg>`;
    case 'bell':
      return `<svg ${s}><path d="M10 1 V5" stroke="#4E7A3E" stroke-width="1.4"/><path d="M5 16 Q5 6 10 5 Q15 6 15 16 L17 18 H3 Z" fill="${c}"/></svg>`;
    default:
      return `<svg ${s}><circle cx="10" cy="10" r="7" fill="${c}"/></svg>`;
  }
}
