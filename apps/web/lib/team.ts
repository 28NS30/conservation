/**
 * Who runs this.
 *
 * The team asked for a page with leadership first, then FormosaWatch with the
 * people in Taiwan, then FlamaWatch with the people in Colombia, each with a
 * headshot, a name, a position and contact details.
 *
 * The roster is EMPTY and must stay that way until the team sends real content.
 * Nothing here may be invented — not a name, not a title, not a placeholder
 * face. A fabricated person on a conservation project's team page is the kind
 * of thing that gets screenshotted, and it would be a strange thing to publish
 * on a site whose whole argument is that its data is real.
 *
 * What is needed per person, and what is missing today:
 *
 *   - the name as they want it written, in both languages;
 *   - their position, in both languages;
 *   - one square headshot, 640px or larger;
 *   - which contact details they agree to publish;
 *   - written consent, per person and per field. This is personal data under
 *     個資法, and the project already holds its reporters to that standard —
 *     /privacy promises exactly this of them.
 *
 * FlamaWatch is a separate organisation. Listing them needs their agreement and
 * their current URL, neither of which we have.
 *
 * While the roster is empty, /team 404s and nothing links to it. That is
 * deliberate: an empty team page says something worse about a project than no
 * team page at all.
 *
 * When the first person is added, add "/team" to app/sitemap.ts. It is left out
 * while the page 404s, and a page nobody can find is the other way to publish
 * nothing.
 */

export type TeamGroup = "leadership" | "formosawatch" | "flamawatch";

export type Person = {
  /** Stable key; also the headshot filename, /team/<id>.jpg. */
  id: string;
  name: { zh: string; en: string };
  role: { zh: string; en: string };
  group: TeamGroup;
  /** Square, 640px or larger, served from public/team/. */
  photo: string;
  /** Only what this person has agreed to publish. Both are optional. */
  email?: string;
  instagram?: string;
};

/** In the order the team asked for. */
export const TEAM_GROUPS: TeamGroup[] = [
  "leadership",
  "formosawatch",
  "flamawatch",
];

export const TEAM: Person[] = [];

/** Whether there is anything to show. Gates both the page and the link to it. */
export const teamPublished = () => TEAM.length > 0;

export const peopleIn = (group: TeamGroup) =>
  TEAM.filter((p) => p.group === group);
