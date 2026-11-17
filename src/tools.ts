// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, REPO, SITE, nursingHomeCompare, nursingHomeRatings, nursingHomeSearch } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'nursing-home-ratings',
  metaDescription: 'MCP server for nursing home ratings from Medicare Care Compare: overall, health inspection, staffing and quality star ratings, nurse staffing hours, staff turnover, cited deficiencies, fines and abuse flags for every US nursing home, from CMS data.',
  intro: 'Nursing home ratings for AI assistants: the CMS Care Compare star ratings, staffing, inspection deficiencies and fines of every Medicare and Medicaid certified nursing home, read live from data.cms.gov.',
};

export const TOOL_INFO = [
  { name: 'nursing_home_search', blurb: 'Nursing homes near a ZIP code or point, or in a city, county or state, ranked by overall, inspection, staffing or quality stars, with filters for a minimum rating, the abuse icon and Special Focus status.' },
  { name: 'nursing_home_ratings', blurb: 'One nursing home in full: the four star ratings and what blank ratings mean, nurse staffing hours against state and US averages, staff turnover, recent cited deficiencies with severity, fines and payment denials, ownership and chain.' },
  { name: 'nursing_home_compare', blurb: '2 to 5 nursing homes side by side: stars, staffing hours, turnover, deficiencies and fines, with the best facility on each measure.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream data.cms.gov error'}: ${msg}` }] };
}
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => { try { return ok((await fn(a)) as any); } catch (e) { return fail(e); } };

const state = z.string().optional().describe('State as a two-letter code (VT) or name (Vermont).');
const facility = {
  ccn: z.string().optional().describe('CMS Certification Number (6 characters, e.g. 475014), from nursing_home_search. Most exact.'),
  name: z.string().optional().describe('Facility name or part of it, if no ccn.'),
  state,
  city: z.string().optional().describe('City, to narrow a name match.'),
};

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'Nursing home ratings from CMS Care Compare (the data behind Medicare.gov), read at call time from data.cms.gov and refreshed monthly by CMS. ' +
      'A model cannot know a facility\'s current star ratings, staffing, fines or recent inspection citations. Use nursing_home_search for "best nursing homes near 05401" or "nursing homes in Burlington, VT", ' +
      'nursing_home_ratings for one facility (by the ccn the search returns), and nursing_home_compare to weigh 2 to 5 options. Suggest a visit and a call to the state ombudsman alongside the ratings.',
  });

  server.registerTool('nursing_home_search', {
    title: 'Find and rank nursing homes',
    description:
      'Find Medicare and Medicaid certified nursing homes near a ZIP code (default 10 miles) or latitude and longitude, or in a city, county or state, or by name, ' +
      'ranked by CMS overall star rating (or inspection, staffing, quality, nurse hours, distance or name). Each result has the four star ratings, beds, ownership, ' +
      'nurse hours per resident per day, staff turnover, fines, the abuse icon, Special Focus Facility status and the ccn for nursing_home_ratings.',
    inputSchema: {
      zip: z.string().optional().describe('5-digit ZIP code to search around.'),
      radius_miles: z.number().min(1).max(50).optional().describe('Radius around the ZIP or point, 1 to 50 miles. Default 10.'),
      latitude: z.number().optional().describe('Latitude to search around (with longitude).'),
      longitude: z.number().optional().describe('Longitude to search around (with latitude).'),
      city: z.string().optional().describe('City or town (use with state).'),
      county: z.string().optional().describe('County or parish (needs state).'),
      state,
      name: z.string().optional().describe('Part of the facility name.'),
      min_overall_rating: z.number().int().min(1).max(5).optional().describe('Only facilities with at least this many overall stars.'),
      exclude_abuse_icon: z.boolean().optional().describe('Leave out facilities CMS flags with the abuse icon.'),
      exclude_special_focus: z.boolean().optional().describe('Leave out Special Focus Facilities and candidates.'),
      sort: z.enum(['overall', 'health_inspection', 'staffing', 'quality_measures', 'nurse_hours', 'distance', 'name']).optional().describe('Sort order. Default overall (ties by inspections, staffing, then distance).'),
      limit: z.number().int().min(1).max(50).optional().describe('How many facilities to return, 1 to 50. Default 15.'),
    },
    annotations: { title: 'Find nursing homes', ...RO },
  }, wrap((a: any) => nursingHomeSearch(fetchText, a)));

  server.registerTool('nursing_home_ratings', {
    title: 'Nursing home ratings and inspection record',
    description:
      'Full CMS Care Compare profile of one nursing home by ccn (or name and state): overall, health inspection, staffing and quality measure star ratings ' +
      '(long-stay and short-stay) with the CMS footnote that explains a blank or 1-star rating, nurse and RN staffing hours per resident per day and weekend staffing ' +
      'against state and US averages, nursing staff and RN turnover, the last inspections, recent cited deficiencies with scope and severity (actual harm, immediate jeopardy), ' +
      'fines and payment denials of the last 3 years, abuse icon, Special Focus status, ownership, chain and the Medicare.gov link.',
    inputSchema: {
      ...facility,
      deficiencies: z.number().int().min(0).max(50).optional().describe('How many of the most recent cited deficiencies to list, 0 to 50. Default 10.'),
    },
    annotations: { title: 'Nursing home ratings', ...RO },
  }, wrap((a: any) => nursingHomeRatings(fetchText, a)));

  server.registerTool('nursing_home_compare', {
    title: 'Compare nursing homes',
    description:
      'Compare 2 to 5 nursing homes side by side from CMS Care Compare: the four star ratings, nurse and RN hours per resident per day, staff turnover, ' +
      'health deficiencies in the latest inspection cycle, fines, abuse icon and Special Focus status, with the leader on each measure and the state averages.',
    inputSchema: {
      facilities: z.array(z.object(facility)).min(2).max(5).describe('2 to 5 facilities, each as {ccn} or {name, state}.'),
    },
    annotations: { title: 'Compare nursing homes', ...RO },
  }, wrap((a: any) => nursingHomeCompare(fetchText, a)));

  return server;
}
