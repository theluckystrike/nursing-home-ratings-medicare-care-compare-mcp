// Pure core for nursing-home-ratings-medicare-care-compare-mcp. The only I/O is keyless reads of the CMS Provider Data
// Catalog datastore API on data.cms.gov (the data behind Medicare Care Compare), done through an injected fetchText.
//
// Datasets (public, no key, refreshed monthly by CMS; every row carries processing_date):
//   4pq5-n9py  Nursing homes: Provider Information (one row per facility: star ratings, staffing, turnover, inspection
//              cycle totals, fines, abuse icon, Special Focus Facility status, ownership, chain, latitude/longitude)
//   g6vv-u9sr  Penalties (fines and payment denials, about the last 3 years)
//   r5ix-sfxw  Health Deficiencies (each cited deficiency with scope and severity, last 3 inspection cycles)
//   xcdc-v8bm  State and US averages
// Query API: GET /provider-data/api/1/datastore/query/<id>/0 with conditions[i][property|value|operator], limit <= 1500.
// Every column is text, so numbers are parsed here and numeric ranges are only pushed upstream for positive latitudes.
import type { FetchText } from './types.js';

export const REPO = 'nursing-home-ratings-medicare-care-compare-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const more = () => `${SITE}/servers/?${UTM}`;
export const API = 'https://data.cms.gov/provider-data/api/1/datastore/query';
export const DS = { provider: '4pq5-n9py', penalties: 'g6vv-u9sr', deficiencies: 'r5ix-sfxw', averages: 'xcdc-v8bm' } as const;
export const SOURCE = 'CMS Care Compare nursing home data (Provider Data Catalog on data.cms.gov: Provider Information, Penalties, Health Deficiencies, State and US Averages), the data behind Medicare.gov Care Compare.';
const TTL = 21600; // CMS refreshes these datasets monthly

export class InputError extends Error {}
export class UpstreamError extends Error {}

type Row = Record<string, string>;
export type Cond = { property: string; value: string | string[]; operator?: string };
export interface Query { conditions?: Cond[]; properties?: string[]; sorts?: { property: string; order: 'asc' | 'desc' }[]; limit?: number; offset?: number }

export function queryUrl(ds: string, q: Query): string {
  const p: string[] = [`limit=${q.limit ?? 100}`];
  if (q.offset) p.push(`offset=${q.offset}`);
  (q.properties ?? []).forEach((x) => p.push(`properties[]=${encodeURIComponent(x)}`));
  (q.conditions ?? []).forEach((c, i) => {
    p.push(`conditions[${i}][property]=${encodeURIComponent(c.property)}`);
    if (Array.isArray(c.value)) c.value.forEach((v, j) => p.push(`conditions[${i}][value][${j}]=${encodeURIComponent(v)}`));
    else p.push(`conditions[${i}][value]=${encodeURIComponent(c.value)}`);
    if (c.operator) p.push(`conditions[${i}][operator]=${encodeURIComponent(c.operator)}`);
  });
  (q.sorts ?? []).forEach((s, i) => p.push(`sorts[${i}][property]=${encodeURIComponent(s.property)}`, `sorts[${i}][order]=${s.order}`));
  p.push('schema=false');
  return `${API}/${ds}/0?${p.join('&')}`;
}

export async function query(f: FetchText, ds: string, q: Query): Promise<{ rows: Row[]; count: number }> {
  let body: string;
  try {
    body = await f(queryUrl(ds, q), { cacheTtl: TTL, timeoutMs: 20000 });
  } catch (e) {
    throw new UpstreamError(`data.cms.gov did not answer (${(e as Error).message}). Try again in a minute.`);
  }
  let d: any;
  try { d = JSON.parse(body); } catch { throw new UpstreamError('data.cms.gov returned something that is not JSON.'); }
  if (!d || !Array.isArray(d.results)) throw new UpstreamError(`data.cms.gov query failed: ${String(d?.message ?? 'no results array').slice(0, 200)}`);
  return { rows: d.results as Row[], count: typeof d.count === 'number' ? d.count : d.results.length };
}

// ---------- helpers ----------
export const num = (s: unknown): number | null => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const yn = (s: unknown) => String(s ?? '').trim().toUpperCase() === 'Y';
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const phone = (s: string) => (/^\d{10}$/.test(s ?? '') ? `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}` : s || null);

export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
  GU: 'Guam', VI: 'U.S. Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands',
};

export function stateCode(s: unknown): string | undefined {
  if (s === undefined || s === null || String(s).trim() === '') return undefined;
  const t = String(s).trim();
  if (/^[A-Za-z]{2}$/.test(t) && STATES[t.toUpperCase()]) return t.toUpperCase();
  const low = t.toLowerCase().replace(/\./g, '');
  for (const [k, v] of Object.entries(STATES)) if (v.toLowerCase().replace(/\./g, '') === low) return k;
  if (low === 'virgin islands' || low === 'us virgin islands') return 'VI';
  throw new InputError(`unknown state "${t}". Use a two-letter code such as VT or a state name.`);
}

/** CMS footnotes that explain a blank or capped star rating (Care Compare nursing home footnote list). */
export const FOOTNOTES: Record<string, string> = {
  '1': 'Newly certified nursing home with less than 12 to 15 months of data, so it is not eligible for a rating yet.',
  '2': 'Not enough data available to calculate a star rating.',
  '18': 'Not rated: this nursing home has a history of serious quality issues and is in the Special Focus Facility program.',
  '23': 'The nursing home did not submit staffing data, so CMS gives it a 1-star staffing rating.',
  '24': 'The nursing home reported a high number of days without a registered nurse on site, so CMS gives it a 1-star staffing rating.',
  '25': 'Staffing data could not be verified through an audit, so CMS gives it a 1-star staffing rating.',
};
export const footnote = (code: string) => FOOTNOTES[code] ?? `CMS footnote ${code} (see the footnote list on Medicare.gov Care Compare).`;

const SFF_TEXT: Record<string, string> = {
  SFF: 'Special Focus Facility: CMS has found a persistent record of serious quality problems and inspects it about twice as often.',
  'SFF Candidate': 'Special Focus Facility candidate: its inspection record qualifies it for the CMS Special Focus Facility program.',
};

export const careCompareUrl = (ccn: string, state: string) => `https://www.medicare.gov/care-compare/details/nursing-home/${ccn}/view-all?state=${state}`;

const stars = (n: number | null) => (n === null ? 'not rated' : `${n} of 5 stars`);

// ---------- facility shaping ----------
export interface Ratings { overall: number | null; health_inspection: number | null; staffing: number | null; quality_measures: number | null; long_stay_quality: number | null; short_stay_quality: number | null }

export function ratingsOf(r: Row): { ratings: Ratings; notes: string[] } {
  const ratings: Ratings = {
    overall: num(r.overall_rating), health_inspection: num(r.health_inspection_rating), staffing: num(r.staffing_rating),
    quality_measures: num(r.qm_rating), long_stay_quality: num(r.longstay_qm_rating), short_stay_quality: num(r.shortstay_qm_rating),
  };
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const [label, k] of [['Overall', 'overall_rating_footnote'], ['Health inspection', 'health_inspection_rating_footnote'], ['Staffing', 'staffing_rating_footnote'],
    ['Quality measures', 'qm_rating_footnote'], ['Long-stay quality', 'longstay_qm_rating_footnote'], ['Short-stay quality', 'shortstay_qm_rating_footnote']] as const) {
    const c = String(r[k] ?? '').trim();
    if (!c) continue;
    const key = `${c}`;
    const text = `${label}: ${footnote(c)}`;
    if (seen.has(key) && ['1', '18'].includes(c)) continue;
    seen.add(key);
    notes.push(text);
  }
  return { ratings, notes };
}

export interface Brief {
  ccn: string; name: string; address: string; city: string; state: string; zip: string; county: string; phone: string | null;
  overall: number | null; health_inspection: number | null; staffing: number | null; quality_measures: number | null;
  beds: number | null; residents_per_day: number | null; ownership_type: string; special_focus_status: string | null; abuse_icon: boolean;
  fines_usd: number | null; total_penalties: number | null; nurse_hours_per_resident_day: number | null; nursing_staff_turnover_pct: number | null;
  distance_miles?: number; latitude: number | null; longitude: number | null; data_date: string | null;
}

export const BRIEF_PROPS = ['cms_certification_number_ccn', 'provider_name', 'provider_address', 'citytown', 'state', 'zip_code', 'countyparish', 'telephone_number',
  'overall_rating', 'health_inspection_rating', 'staffing_rating', 'qm_rating', 'number_of_certified_beds', 'average_number_of_residents_per_day', 'ownership_type',
  'special_focus_status', 'abuse_icon', 'total_amount_of_fines_in_dollars', 'total_number_of_penalties', 'reported_total_nurse_staffing_hours_per_resident_per_day',
  'total_nursing_staff_turnover', 'latitude', 'longitude', 'processing_date'];

export function brief(r: Row): Brief {
  return {
    ccn: r.cms_certification_number_ccn, name: r.provider_name, address: r.provider_address, city: r.citytown, state: r.state, zip: r.zip_code,
    county: r.countyparish, phone: phone(r.telephone_number),
    overall: num(r.overall_rating), health_inspection: num(r.health_inspection_rating), staffing: num(r.staffing_rating), quality_measures: num(r.qm_rating),
    beds: num(r.number_of_certified_beds), residents_per_day: num(r.average_number_of_residents_per_day), ownership_type: r.ownership_type,
    special_focus_status: r.special_focus_status || null, abuse_icon: yn(r.abuse_icon),
    fines_usd: num(r.total_amount_of_fines_in_dollars), total_penalties: num(r.total_number_of_penalties),
    nurse_hours_per_resident_day: r2(num(r.reported_total_nurse_staffing_hours_per_resident_per_day)),
    nursing_staff_turnover_pct: num(r.total_nursing_staff_turnover), latitude: num(r.latitude), longitude: num(r.longitude),
    data_date: r.processing_date || null,
  };
}

export function detail(r: Row) {
  const { ratings, notes } = ratingsOf(r);
  const chain = r.chain_name ? {
    name: r.chain_name, facilities: num(r.number_of_facilities_in_chain),
    average_overall: num(r.chain_average_overall_5star_rating), average_health_inspection: num(r.chain_average_health_inspection_rating),
    average_staffing: num(r.chain_average_staffing_rating), average_quality: num(r.chain_average_qm_rating),
  } : null;
  return {
    ccn: r.cms_certification_number_ccn, name: r.provider_name, legal_business_name: r.legal_business_name || null,
    address: r.provider_address, city: r.citytown, state: r.state, zip: r.zip_code, county: r.countyparish, phone: phone(r.telephone_number),
    ratings, rating_notes: notes,
    special_focus_status: r.special_focus_status || null, special_focus_meaning: SFF_TEXT[r.special_focus_status] ?? null,
    abuse_icon: yn(r.abuse_icon), abuse_icon_meaning: yn(r.abuse_icon) ? 'CMS flags this nursing home for abuse: it was cited for abuse that harmed a resident in the last year, or for potential abuse in each of the last 2 years.' : null,
    beds: num(r.number_of_certified_beds), residents_per_day: num(r.average_number_of_residents_per_day), provider_type: r.provider_type,
    ownership_type: r.ownership_type, chain, inside_a_hospital: yn(r.provider_resides_in_hospital),
    continuing_care_retirement_community: yn(r.continuing_care_retirement_community),
    changed_ownership_last_12_months: yn(r.provider_changed_ownership_in_last_12_months),
    resident_and_family_council: r.with_a_resident_and_family_council || null, sprinklers_in_all_required_areas: r.automatic_sprinkler_systems_in_all_required_areas || null,
    first_certified: r.date_first_approved_to_provide_medicare_and_medicaid_services || null,
    staffing: {
      total_nurse_hours_per_resident_day: r2(num(r.reported_total_nurse_staffing_hours_per_resident_per_day)),
      rn_hours_per_resident_day: r2(num(r.reported_rn_staffing_hours_per_resident_per_day)),
      lpn_hours_per_resident_day: r2(num(r.reported_lpn_staffing_hours_per_resident_per_day)),
      nurse_aide_hours_per_resident_day: r2(num(r.reported_nurse_aide_staffing_hours_per_resident_per_day)),
      weekend_total_nurse_hours_per_resident_day: r2(num(r.total_number_of_nurse_staff_hours_per_resident_per_day_on_t_4a14)),
      weekend_rn_hours_per_resident_day: r2(num(r.registered_nurse_hours_per_resident_per_day_on_the_weekend)),
      physical_therapist_hours_per_resident_day: r2(num(r.reported_physical_therapist_staffing_hours_per_resident_per_day)),
      expected_total_nurse_hours_for_resident_needs: r2(num(r.casemix_total_nurse_staffing_hours_per_resident_per_day)),
      nursing_staff_turnover_pct: num(r.total_nursing_staff_turnover), rn_turnover_pct: num(r.registered_nurse_turnover),
      administrators_who_left: num(r.number_of_administrators_who_have_left_the_nursing_home),
    },
    inspections: {
      last_standard_inspection: r.rating_cycle_1_standard_survey_health_date || null,
      last_inspection_more_than_2_years_ago: yn(r.most_recent_health_inspection_more_than_2_years_ago),
      cycle_1_health_deficiencies: num(r.rating_cycle_1_total_number_of_health_deficiencies),
      cycle_1_standard_deficiencies: num(r.rating_cycle_1_number_of_standard_health_deficiencies),
      cycle_1_complaint_deficiencies: num(r.rating_cycle_1_number_of_complaint_health_deficiencies),
      previous_standard_inspection: r.rating_cycle_2_standard_health_survey_date || null,
      cycles_2_3_health_deficiencies: num(r.rating_cycle_23_total_number_of_health_deficiencies),
      weighted_health_inspection_score: num(r.total_weighted_health_survey_score),
      infection_control_citations: num(r.number_of_citations_from_infection_control_inspections),
    },
    penalties_3_years: {
      fines: num(r.number_of_fines), fines_total_usd: num(r.total_amount_of_fines_in_dollars),
      payment_denials: num(r.number_of_payment_denials), total_penalties: num(r.total_number_of_penalties),
    },
    latitude: num(r.latitude), longitude: num(r.longitude),
    care_compare_url: careCompareUrl(r.cms_certification_number_ccn, r.state),
    data_date: r.processing_date || null,
  };
}

// ---------- geography ----------
export function miles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** ZIP centre from the nursing homes CMS lists in that ZIP, else in its 4-digit, then 3-digit ZIP prefix. */
export async function zipCenter(f: FetchText, zip: string): Promise<{ lat: number; lon: number; basis: string }> {
  const tries: [string, Cond][] = [
    [`nursing homes in ZIP ${zip}`, { property: 'zip_code', value: zip }],
    [`nursing homes in ZIPs ${zip.slice(0, 4)}x`, { property: 'zip_code', value: `${zip.slice(0, 4)}%`, operator: 'LIKE' }],
    [`nursing homes in ZIPs ${zip.slice(0, 3)}xx`, { property: 'zip_code', value: `${zip.slice(0, 3)}%`, operator: 'LIKE' }],
  ];
  for (const [basis, c] of tries) {
    const { rows } = await query(f, DS.provider, { conditions: [c], properties: ['latitude', 'longitude'], limit: 500 });
    const pts = rows.map((r) => [num(r.latitude), num(r.longitude)]).filter((p): p is [number, number] => p[0] !== null && p[1] !== null);
    if (pts.length) return { lat: mean(pts.map((p) => p[0])), lon: mean(pts.map((p) => p[1])), basis: `centre of the ${pts.length} ${basis}` };
  }
  throw new InputError(`CMS lists no nursing homes in or near ZIP ${zip}. Search by city and state instead.`);
}

/** All facilities with a latitude in [lat - d, lat + d]. Latitudes are text upstream; every US latitude has two integer digits, so a text range is a numeric range. */
export async function latBand(f: FetchText, lat: number, d: number): Promise<Row[]> {
  const lo = Math.max(10, lat - d).toFixed(4), hi = Math.min(99.9999, lat + d).toFixed(4);
  const out: Row[] = [];
  for (let page = 0; page < 4; page++) {
    const { rows, count } = await query(f, DS.provider, {
      conditions: [{ property: 'latitude', value: [lo, hi], operator: 'between' }], properties: BRIEF_PROPS, limit: 1500, offset: page * 1500,
    });
    out.push(...rows);
    if (out.length >= count || rows.length < 1500) break;
  }
  return out;
}

// ---------- tools ----------
export type SortKey = 'overall' | 'health_inspection' | 'staffing' | 'quality_measures' | 'distance' | 'name' | 'nurse_hours';

export function sortBriefs(list: Brief[], sort: SortKey): Brief[] {
  const desc = (k: keyof Brief) => (a: Brief, b: Brief) => ((b[k] as number | null) ?? -1) - ((a[k] as number | null) ?? -1);
  const tie = (a: Brief, b: Brief) => (a.distance_miles ?? 0) - (b.distance_miles ?? 0) || a.name.localeCompare(b.name);
  const by: Record<SortKey, (a: Brief, b: Brief) => number> = {
    overall: (a, b) => desc('overall')(a, b) || desc('health_inspection')(a, b) || desc('staffing')(a, b) || tie(a, b),
    health_inspection: (a, b) => desc('health_inspection')(a, b) || desc('overall')(a, b) || tie(a, b),
    staffing: (a, b) => desc('staffing')(a, b) || desc('overall')(a, b) || tie(a, b),
    quality_measures: (a, b) => desc('quality_measures')(a, b) || desc('overall')(a, b) || tie(a, b),
    nurse_hours: (a, b) => desc('nurse_hours_per_resident_day')(a, b) || tie(a, b),
    distance: (a, b) => (a.distance_miles ?? 1e9) - (b.distance_miles ?? 1e9) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return [...list].sort(by[sort]);
}

const line = (b: Brief, i: number) =>
  `${i + 1}. ${b.name} (${b.city}, ${b.state}${b.distance_miles !== undefined ? `, ${b.distance_miles} mi` : ''}): overall ${b.overall ?? 'not rated'}, ` +
  `inspections ${b.health_inspection ?? '-'}, staffing ${b.staffing ?? '-'}, quality ${b.quality_measures ?? '-'}` +
  `${b.special_focus_status ? `; ${b.special_focus_status}` : ''}${b.abuse_icon ? '; abuse icon' : ''}`;

export async function nursingHomeSearch(f: FetchText, a: {
  zip?: string; city?: string; county?: string; state?: string; name?: string; latitude?: number; longitude?: number;
  radius_miles?: number; min_overall_rating?: number; sort?: SortKey; limit?: number; exclude_abuse_icon?: boolean; exclude_special_focus?: boolean;
}) {
  const st = stateCode(a.state);
  const zipIn = a.zip !== undefined && a.zip !== null && String(a.zip).trim() !== '' ? String(a.zip).trim().padStart(5, '0').slice(0, 5) : undefined;
  if (zipIn !== undefined && !/^\d{5}$/.test(zipIn)) throw new InputError(`ZIP "${a.zip}" is not a 5-digit US ZIP code.`);
  const zip = zipIn;
  const hasPoint = typeof a.latitude === 'number' && typeof a.longitude === 'number';
  if ((typeof a.latitude === 'number') !== (typeof a.longitude === 'number')) throw new InputError('Give both latitude and longitude.');
  if (!zip && !hasPoint && !a.city && !a.county && !a.name && !st) throw new InputError('Give a ZIP code, a city and state, a county and state, a facility name, a state, or latitude and longitude.');
  if (a.county && !st) throw new InputError('A county search needs the state too.');
  const limit = Math.min(50, Math.max(1, Math.round(a.limit ?? 15)));
  let list: Brief[] = [];
  let where = '';
  let center: { lat: number; lon: number; basis: string } | null = null;
  let radius: number | null = null;
  if (zip || hasPoint) {
    radius = Math.min(50, Math.max(1, a.radius_miles ?? 10));
    center = hasPoint ? { lat: a.latitude as number, lon: a.longitude as number, basis: 'the given coordinates' } : await zipCenter(f, zip as string);
    if (center.lat < 10) throw new InputError('Only US nursing homes are covered; latitude must be in the US.');
    const rows = await latBand(f, center.lat, radius / 69 + 0.01);
    const c = center;
    list = rows.map((r) => {
      const b = brief(r);
      if (b.latitude !== null && b.longitude !== null) b.distance_miles = Math.round(miles(c.lat, c.lon, b.latitude, b.longitude) * 10) / 10;
      return b;
    }).filter((b) => b.distance_miles !== undefined && b.distance_miles <= (radius as number));
    if (st) list = list.filter((b) => b.state === st);
    if (a.name) list = list.filter((b) => b.name.toLowerCase().includes(String(a.name).toLowerCase()));
    where = `within ${radius} miles of ${zip ? `ZIP ${zip}` : `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`}`;
  } else {
    const conds: Cond[] = [];
    if (st) conds.push({ property: 'state', value: st });
    if (a.city) conds.push({ property: 'citytown', value: String(a.city).trim() });
    if (a.county) conds.push({ property: 'countyparish', value: String(a.county).trim().replace(/\s+(county|parish|borough|census area|municipality)$/i, '') });
    if (a.name) conds.push({ property: 'provider_name', value: `%${String(a.name).trim()}%`, operator: 'LIKE' });
    const { rows } = await query(f, DS.provider, { conditions: conds, properties: BRIEF_PROPS, limit: 1500 });
    list = rows.map(brief);
    if (a.city && list.length === 0) {
      // CMS spells some towns "Saint Johnsbury" or "St. Albans"; retry with the other spelling.
      const alt = String(a.city).trim().replace(/^(st\.?|saint)\s+/i, (m) => (/^saint/i.test(m) ? 'St. ' : 'Saint '));
      if (alt !== String(a.city).trim()) {
        conds[conds.findIndex((c) => c.property === 'citytown')] = { property: 'citytown', value: alt };
        list = (await query(f, DS.provider, { conditions: conds, properties: BRIEF_PROPS, limit: 1500 })).rows.map(brief);
      }
    }
    where = [a.name ? `named like "${a.name}"` : '', a.city ? `in ${a.city}` : '', a.county ? `in ${conds.find((c) => c.property === 'countyparish')?.value} County` : '', st ? `${a.city || a.county ? ', ' : 'in '}${STATES[st]}` : '']
      .filter(Boolean).join(' ').replace(' , ', ', ');
  }
  const found = list.length;
  if (a.min_overall_rating) list = list.filter((b) => (b.overall ?? 0) >= (a.min_overall_rating as number));
  if (a.exclude_abuse_icon) list = list.filter((b) => !b.abuse_icon);
  if (a.exclude_special_focus) list = list.filter((b) => !b.special_focus_status);
  const sort: SortKey = a.sort ?? 'overall';
  if (sort === 'distance' && !center) throw new InputError('sort "distance" needs a ZIP or latitude and longitude.');
  list = sortBriefs(list, sort);
  const dist: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0, not_rated: 0 };
  for (const b of list) dist[b.overall === null ? 'not_rated' : String(b.overall)]++;
  const shown = list.slice(0, limit);
  const filt = [a.min_overall_rating ? `${a.min_overall_rating}+ stars overall` : '', a.exclude_abuse_icon ? 'no abuse icon' : '', a.exclude_special_focus ? 'no Special Focus status' : ''].filter(Boolean).join(', ');
  const summary = list.length === 0
    ? `No nursing homes found ${where}${filt ? ` with ${filt}` : ''} in CMS Care Compare data${found ? ` (${found} before the filters)` : ''}.`
    : `${list.length} nursing home${list.length === 1 ? '' : 's'} ${where}${filt ? ` with ${filt}` : ''} (CMS Care Compare). Overall stars: 5: ${dist['5']}, 4: ${dist['4']}, 3: ${dist['3']}, 2: ${dist['2']}, 1: ${dist['1']}, not rated: ${dist.not_rated}. ` +
      `Sorted by ${sort.replace('_', ' ')}:\n${shown.slice(0, 10).map(line).join('\n')}${list.length > 10 ? `\n(${Math.min(list.length, limit) > 10 ? `${Math.min(list.length, limit) - 10} more in facilities, ` : ''}${list.length} in total)` : ''}`;
  return {
    summary, where, center, radius_miles: radius, total: list.length, found_before_filters: found, star_distribution: dist, sort,
    facilities: shown.map(({ latitude, longitude, data_date, ...b }) => ({ ...b, care_compare_url: careCompareUrl(b.ccn, b.state) })),
    how_to_read: 'Overall rating is 1 to 5 stars from health inspections, staffing and quality measures. Use nursing_home_ratings with a ccn for staffing hours, turnover, cited deficiencies and fines.',
    as_of: list[0]?.data_date ?? null, source: SOURCE, more: more(),
  };
}

/** Resolve one facility by CCN, or by name (with optional state and city). */
export async function findFacility(f: FetchText, a: { ccn?: string; name?: string; state?: string; city?: string }): Promise<{ row: Row; others: Brief[] }> {
  if (a.ccn !== undefined && String(a.ccn).trim() !== '') {
    const ccn = String(a.ccn).trim().toUpperCase().padStart(6, '0');
    if (!/^[0-9A-Z]{6}$/.test(ccn)) throw new InputError(`CCN "${a.ccn}" is not a 6-character CMS Certification Number.`);
    const { rows } = await query(f, DS.provider, { conditions: [{ property: 'cms_certification_number_ccn', value: ccn }], limit: 1 });
    if (!rows.length) throw new InputError(`No nursing home with CCN ${ccn} in CMS Care Compare data. Use nursing_home_search to find the CCN.`);
    return { row: rows[0], others: [] };
  }
  const name = String(a.name ?? '').trim();
  if (name.length < 3) throw new InputError('Give a ccn, or a facility name of at least 3 characters (with the state if you know it).');
  const st = stateCode(a.state);
  const conds: Cond[] = [{ property: 'provider_name', value: `%${name}%`, operator: 'LIKE' }];
  if (st) conds.push({ property: 'state', value: st });
  if (a.city) conds.push({ property: 'citytown', value: String(a.city).trim() });
  let { rows } = await query(f, DS.provider, { conditions: conds, limit: 50 });
  if (!rows.length) {
    // Retry on the longest words, so "Wake Robin Linden" finds "Wake Robin-Linden Nursing Home".
    const words = name.split(/[^A-Za-z0-9']+/).filter((w) => w.length >= 4).sort((x, y) => y.length - x.length).slice(0, 2);
    if (words.length) {
      const c2: Cond[] = [...conds.slice(1), ...words.map((w) => ({ property: 'provider_name', value: `%${w}%`, operator: 'LIKE' }))];
      rows = (await query(f, DS.provider, { conditions: c2, limit: 50 })).rows;
    }
  }
  if (!rows.length) throw new InputError(`No nursing home named like "${name}"${st ? ` in ${STATES[st]}` : ''} in CMS Care Compare data. Try a shorter part of the name or nursing_home_search.`);
  const low = name.toLowerCase();
  const score = (r: Row) => { const n = r.provider_name.toLowerCase(); return n === low ? 0 : n.startsWith(low) ? 1 : n.includes(low) ? 2 : 3; };
  rows = [...rows].sort((x, y) => score(x) - score(y) || x.provider_name.localeCompare(y.provider_name));
  return { row: rows[0], others: rows.slice(1, 11).map(brief) };
}

const SEVERITY: Record<string, string> = {
  A: 'no actual harm, minimal harm potential, isolated', B: 'no actual harm, minimal harm potential, pattern', C: 'no actual harm, minimal harm potential, widespread',
  D: 'no actual harm, potential for more than minimal harm, isolated', E: 'no actual harm, potential for more than minimal harm, pattern', F: 'no actual harm, potential for more than minimal harm, widespread',
  G: 'actual harm, isolated', H: 'actual harm, pattern', I: 'actual harm, widespread',
  J: 'immediate jeopardy to resident health or safety, isolated', K: 'immediate jeopardy, pattern', L: 'immediate jeopardy, widespread',
};

export async function averages(f: FetchText, states: string[]): Promise<Record<string, Row>> {
  const keys = [...new Set([...states, 'NATION'])];
  const { rows } = await query(f, DS.averages, { conditions: [{ property: 'state_or_nation', value: keys, operator: 'in' }], limit: 100 });
  return Object.fromEntries(rows.map((r) => [r.state_or_nation, r]));
}

const avgView = (r: Row | undefined) => r ? {
  overall: num(r.overall_rating), health_inspection: num(r.health_inspection_rating), staffing: num(r.staffing_rating), quality_measures: num(r.qm_rating),
  cycle_1_health_deficiencies: num(r.cycle_1_total_number_of_health_deficiencies), total_nurse_hours_per_resident_day: r2(num(r.reported_total_nurse_staffing_hours_per_resident_per_day)),
  rn_hours_per_resident_day: r2(num(r.reported_rn_staffing_hours_per_resident_per_day)), nursing_staff_turnover_pct: num(r.total_nursing_staff_turnover),
  fines: num(r.number_of_fines), fines_usd: num(r.fine_amount_in_dollars),
} : null;

export async function nursingHomeRatings(f: FetchText, a: { ccn?: string; name?: string; state?: string; city?: string; deficiencies?: number }) {
  const { row, others } = await findFacility(f, a);
  const d = detail(row);
  const nDef = Math.min(50, Math.max(0, Math.round(a.deficiencies ?? 10)));
  const [pen, def, avg] = await Promise.all([
    query(f, DS.penalties, { conditions: [{ property: 'cms_certification_number_ccn', value: d.ccn }], limit: 100 }),
    query(f, DS.deficiencies, { conditions: [{ property: 'cms_certification_number_ccn', value: d.ccn }], limit: 300 }),
    averages(f, [d.state]),
  ]);
  const penalties = pen.rows.map((p) => ({
    date: p.penalty_date, type: p.penalty_type, fine_usd: num(p.fine_amount),
    payment_denial_start: p.payment_denial_start_date || null, payment_denial_days: num(p.payment_denial_length_in_days),
  })).sort((x, y) => y.date.localeCompare(x.date));
  const defs = def.rows.map((x) => ({
    survey_date: x.survey_date, inspection_cycle: num(x.inspection_cycle), category: x.deficiency_category, tag: `${x.deficiency_prefix}${x.deficiency_tag_number}`,
    description: x.deficiency_description, scope_severity: x.scope_severity_code, severity_meaning: SEVERITY[x.scope_severity_code] ?? null,
    complaint: yn(x.complaint_deficiency), standard_inspection: yn(x.standard_deficiency), corrected: x.deficiency_corrected, correction_date: x.correction_date || null,
  })).sort((x, y) => y.survey_date.localeCompare(x.survey_date) || x.tag.localeCompare(y.tag));
  const harm = defs.filter((x) => /^[G-I]$/.test(x.scope_severity)).length;
  const ij = defs.filter((x) => /^[J-L]$/.test(x.scope_severity)).length;
  const st = avgView(avg[d.state]), us = avgView(avg.NATION);
  const R = d.ratings;
  const parts: string[] = [];
  parts.push(`${d.name}, ${d.city}, ${d.state} (CCN ${d.ccn}): overall ${stars(R.overall)}; health inspections ${R.health_inspection ?? 'not rated'}, staffing ${R.staffing ?? 'not rated'}, quality measures ${R.quality_measures ?? 'not rated'}` +
    `${R.long_stay_quality !== null || R.short_stay_quality !== null ? ` (long-stay ${R.long_stay_quality ?? '-'}, short-stay ${R.short_stay_quality ?? '-'})` : ''}.`);
  if (d.rating_notes.length) parts.push(d.rating_notes.join(' '));
  if (d.special_focus_status) parts.push(`${d.special_focus_status}.`);
  if (d.abuse_icon) parts.push('Abuse icon: cited for abuse.');
  const S = d.staffing;
  if (S.total_nurse_hours_per_resident_day !== null)
    parts.push(`Nurse staffing ${S.total_nurse_hours_per_resident_day} hours per resident per day (${STATES[d.state] ?? d.state} ${st?.total_nurse_hours_per_resident_day ?? '-'}, US ${us?.total_nurse_hours_per_resident_day ?? '-'}), RN ${S.rn_hours_per_resident_day ?? '-'}` +
      `${S.nursing_staff_turnover_pct !== null ? `; nursing staff turnover ${S.nursing_staff_turnover_pct}% (US ${us?.nursing_staff_turnover_pct ?? '-'}%)` : ''}.`);
  const I = d.inspections;
  if (I.last_standard_inspection) parts.push(`Last standard inspection ${I.last_standard_inspection}: ${I.cycle_1_health_deficiencies ?? 0} health deficienc${I.cycle_1_health_deficiencies === 1 ? 'y' : 'ies'} in the latest cycle (US average ${us?.cycle_1_health_deficiencies ?? '-'}).` +
    `${harm || ij ? ` ${harm} cited deficienc${harm === 1 ? 'y' : 'ies'} caused actual harm${ij ? ` and ${ij} put residents in immediate jeopardy` : ''} over the last 3 cycles.` : ''}`);
  const P = d.penalties_3_years;
  parts.push(P.fines ? `${P.fines} fine${P.fines === 1 ? '' : 's'} totaling ${money(P.fines_total_usd ?? 0)} in the last 3 years${penalties[0] ? `; latest ${penalties[0].type.toLowerCase()} ${penalties[0].fine_usd ? money(penalties[0].fine_usd) + ' ' : ''}on ${penalties[0].date}` : ''}.` : 'No fines in the last 3 years.');
  if (P.payment_denials) parts.push(`${P.payment_denials} Medicare payment denial${P.payment_denials === 1 ? '' : 's'}.`);
  parts.push(`CMS data of ${d.data_date}.`);
  return {
    summary: parts.join(' '), facility: d,
    state_average: st, us_average: us,
    penalties, deficiencies_total: defs.length, deficiencies_causing_harm: harm, deficiencies_immediate_jeopardy: ij,
    recent_deficiencies: defs.slice(0, nDef),
    other_matches: others.length ? others.map((o) => ({ ccn: o.ccn, name: o.name, city: o.city, state: o.state, overall: o.overall })) : undefined,
    how_to_read: 'Stars run 1 (much below average) to 5 (much above average) within each state for health inspections. Scope and severity letters: A-C minimal, D-F potential harm, G-I actual harm, J-L immediate jeopardy. Visit and ask the facility about any recent deficiency.',
    as_of: d.data_date, source: SOURCE, more: more(),
  };
}

export async function nursingHomeCompare(f: FetchText, a: { facilities: { ccn?: string; name?: string; state?: string; city?: string }[] }) {
  const list = a.facilities ?? [];
  if (list.length < 2 || list.length > 5) throw new InputError('Compare 2 to 5 nursing homes; give each as a ccn or a name with its state.');
  const found = await Promise.all(list.map((x) => findFacility(f, x)));
  const rows = found.map((x) => x.row);
  const ccns = new Set<string>();
  for (const r of rows) { if (ccns.has(r.cms_certification_number_ccn)) throw new InputError(`${r.provider_name} (${r.cms_certification_number_ccn}) is listed twice.`); ccns.add(r.cms_certification_number_ccn); }
  const avg = await averages(f, rows.map((r) => r.state));
  const ds = rows.map(detail);
  const cmp = ds.map((d) => ({
    ccn: d.ccn, name: d.name, city: d.city, state: d.state, ...d.ratings, rating_notes: d.rating_notes,
    special_focus_status: d.special_focus_status, abuse_icon: d.abuse_icon, beds: d.beds, ownership_type: d.ownership_type, chain: d.chain?.name ?? null,
    total_nurse_hours_per_resident_day: d.staffing.total_nurse_hours_per_resident_day, rn_hours_per_resident_day: d.staffing.rn_hours_per_resident_day,
    nursing_staff_turnover_pct: d.staffing.nursing_staff_turnover_pct, last_standard_inspection: d.inspections.last_standard_inspection,
    cycle_1_health_deficiencies: d.inspections.cycle_1_health_deficiencies, fines_3_years: d.penalties_3_years.fines, fines_total_usd: d.penalties_3_years.fines_total_usd,
    care_compare_url: d.care_compare_url,
  }));
  type C = (typeof cmp)[number];
  const best = (k: keyof C, dir: 1 | -1) => {
    const xs = cmp.filter((c) => typeof c[k] === 'number');
    if (!xs.length) return null;
    const v = dir === 1 ? Math.max(...xs.map((c) => c[k] as number)) : Math.min(...xs.map((c) => c[k] as number));
    return { value: v, facilities: xs.filter((c) => c[k] === v).map((c) => c.name) };
  };
  const leaders = {
    overall: best('overall', 1), health_inspection: best('health_inspection', 1), staffing: best('staffing', 1), quality_measures: best('quality_measures', 1),
    most_nurse_hours: best('total_nurse_hours_per_resident_day', 1), lowest_turnover: best('nursing_staff_turnover_pct', -1),
    fewest_deficiencies: best('cycle_1_health_deficiencies', -1), lowest_fines_usd: best('fines_total_usd', -1),
  };
  const lines = cmp.map((c) => `${c.name} (${c.city}, ${c.state}): overall ${c.overall ?? 'not rated'}, inspections ${c.health_inspection ?? '-'}, staffing ${c.staffing ?? '-'}, quality ${c.quality_measures ?? '-'}; ` +
    `${c.total_nurse_hours_per_resident_day ?? '-'} nurse hours per resident day, turnover ${c.nursing_staff_turnover_pct ?? '-'}%, ${c.cycle_1_health_deficiencies ?? '-'} deficienc${c.cycle_1_health_deficiencies === 1 ? 'y' : 'ies'}, fines ${money(c.fines_total_usd ?? 0)}` +
    `${c.special_focus_status ? `, ${c.special_focus_status}` : ''}${c.abuse_icon ? ', abuse icon' : ''}`);
  const top = leaders.overall ? `Highest overall rating: ${leaders.overall.facilities.join(' and ')} (${leaders.overall.value} stars).` : 'None of these is rated overall.';
  return {
    summary: `${top}\n${lines.join('\n')}`, facilities: cmp, leaders,
    state_averages: Object.fromEntries(Object.entries(avg).map(([k, v]) => [k, avgView(v)])),
    as_of: ds[0].data_date, source: SOURCE, more: more(),
  };
}
