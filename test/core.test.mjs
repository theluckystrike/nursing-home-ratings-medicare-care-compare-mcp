// Fixtures in test/fixtures/ were downloaded 2026-11-17 12:00Z from the data.cms.gov Provider Data Catalog datastore API
// (CMS processing_date 2026-10-01): providers.json = all 33 Vermont rows of Provider Information (4pq5-n9py) plus one
// Special Focus Facility row (015463, footnote 18) and one newly certified row (045480, footnote 1); penalties.json and
// deficiencies.json = every Penalties (g6vv-u9sr) and Health Deficiencies (r5ix-sfxw) row for CCN 475014; averages.json =
// the VT and NATION rows of State US Averages (xcdc-v8bm). Expected values were computed separately in Python from these files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  queryUrl, nursingHomeSearch, nursingHomeRatings, nursingHomeCompare, stateCode, footnote, miles, InputError, UpstreamError, UTM, DS,
} from '../dist/core.js';

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const TABLES = { [DS.provider]: load('providers.json'), [DS.penalties]: load('penalties.json'), [DS.deficiencies]: load('deficiencies.json'), [DS.averages]: load('averages.json') };

// A small emulator of the DKAN datastore query API: conditions with =, LIKE, between and in (text, case-insensitive), properties, limit, offset.
const seen = [];
const f = async (u) => {
  seen.push(u);
  const m = /^https:\/\/data\.cms\.gov\/provider-data\/api\/1\/datastore\/query\/([a-z0-9-]+)\/0\?(.*)$/.exec(u);
  if (!m || !TABLES[m[1]]) throw new Error(`HTTP 404 (no fixture for ${u})`);
  const conds = []; const props = []; let limit = 100; let offset = 0;
  for (const kv of m[2].split('&')) {
    const [k, v0] = kv.split('='); const v = decodeURIComponent(v0 ?? '');
    let b;
    if (k === 'limit') limit = Number(v);
    else if (k === 'offset') offset = Number(v);
    else if (k === 'properties[]') props.push(v);
    else if ((b = /^conditions\[(\d+)\]\[(property|operator)\]$/.exec(k))) (conds[b[1]] ??= { value: [] })[b[2]] = v;
    else if ((b = /^conditions\[(\d+)\]\[value\](?:\[(\d+)\])?$/.exec(k))) { const c = (conds[b[1]] ??= { value: [] }); if (b[2] === undefined) c.single = v; else c.value[Number(b[2])] = v; }
    else assert.ok(['schema'].includes(k), `unexpected parameter ${k}`);
  }
  assert.ok(limit <= 1500, 'limit above the API maximum of 1500');
  const lc = (s) => String(s ?? '').toLowerCase();
  const match = (r, c) => {
    const x = lc(r[c.property]); const op = c.operator ?? '=';
    if (op === '=') return x === lc(c.single);
    if (op === 'LIKE') return new RegExp('^' + lc(c.single).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$').test(x);
    if (op === 'between') return x >= lc(c.value[0]) && x <= lc(c.value[1]);
    if (op === 'in') return c.value.map(lc).includes(x);
    throw new Error(`operator ${op}`);
  };
  const rows = TABLES[m[1]].filter((r) => conds.every((c) => match(r, c)));
  const page = rows.slice(offset, offset + limit).map((r) => (props.length ? Object.fromEntries(props.map((p) => [p, r[p]])) : r));
  return JSON.stringify({ results: page, count: rows.length });
};

test('query URLs: conditions, array values, operators and the limit', () => {
  const u = queryUrl(DS.provider, { conditions: [{ property: 'state', value: 'VT' }, { property: 'latitude', value: ['44.1', '44.9'], operator: 'between' }], properties: ['provider_name'], limit: 1500 });
  assert.equal(u, 'https://data.cms.gov/provider-data/api/1/datastore/query/4pq5-n9py/0?limit=1500&properties[]=provider_name&conditions[0][property]=state&conditions[0][value]=VT' +
    '&conditions[1][property]=latitude&conditions[1][value][0]=44.1&conditions[1][value][1]=44.9&conditions[1][operator]=between&schema=false');
  assert.match(queryUrl(DS.provider, { conditions: [{ property: 'provider_name', value: '%Rehab & Health%', operator: 'LIKE' }] }), /value=%25Rehab%20%26%20Health%25&conditions\[0\]\[operator\]=LIKE/);
  assert.equal(stateCode('vermont'), 'VT'); assert.equal(stateCode('vt'), 'VT'); assert.equal(stateCode(undefined), undefined); assert.throws(() => stateCode('Vermontia'), InputError);
  assert.match(footnote('18'), /Special Focus Facility/); assert.match(footnote('99'), /CMS footnote 99/);
  assert.equal(Math.round(miles(44.4806, -73.207, 44.357, -73.248) * 10) / 10, 8.8);
});

test('search near ZIP 05401, 10 miles: 4 homes, ranked by overall then inspections then staffing', async () => {
  const r = await nursingHomeSearch(f, { zip: '05401' });
  assert.equal(r.radius_miles, 10);
  assert.equal(r.center.lat, 44.4806); assert.equal(r.center.lon, -73.207);
  assert.deepEqual(r.facilities.map((x) => [x.name, x.overall, x.distance_miles]), [
    ['Wake Robin-Linden Nursing Home', 5, 8.8], ['Birchwood Terrace Rehab & Healthcare', 5, 3.6],
    ['Elderwood at Burlington', 2, 3.7], ['Premier Rehab and Healthcare at Burlington', 1, 0],
  ]);
  assert.ok(seen.some((u) => u.includes('conditions[0][value][0]=44.3257&conditions[0][value][1]=44.6355&conditions[0][operator]=between')));
  assert.equal(r.as_of, '2026-10-01');
  assert.match(r.summary, /^4 nursing homes within 10 miles of ZIP 05401/);
  assert.equal(r.facilities[0].care_compare_url, 'https://www.medicare.gov/care-compare/details/nursing-home/475056/view-all?state=VT');
  assert.equal(r.facilities[0].latitude, undefined);
  const d = await nursingHomeSearch(f, { zip: '5401', sort: 'distance', radius_miles: 5 });
  assert.deepEqual(d.facilities.map((x) => x.name), ['Premier Rehab and Healthcare at Burlington', 'Birchwood Terrace Rehab & Healthcare', 'Elderwood at Burlington']);
});

test('search by city (with the St./Saint retry), by state with a minimum rating, and the star distribution', async () => {
  const b = await nursingHomeSearch(f, { city: 'burlington', state: 'Vermont' });
  assert.deepEqual(b.facilities.map((x) => [x.name, x.overall]), [['Birchwood Terrace Rehab & Healthcare', 5], ['Elderwood at Burlington', 2], ['Premier Rehab and Healthcare at Burlington', 1]]);
  assert.match(b.where, /in burlington, Vermont/);
  const sj = await nursingHomeSearch(f, { city: 'St. Johnsbury', state: 'VT' });
  assert.deepEqual(sj.facilities.map((x) => x.name), ['St. Johnsbury Health & Rehab']);
  const vt = await nursingHomeSearch(f, { state: 'VT', limit: 50 });
  assert.equal(vt.total, 33);
  assert.deepEqual(vt.star_distribution, { 5: 6, 4: 7, 3: 5, 2: 7, 1: 7, not_rated: 1 });
  assert.equal(vt.facilities[32].name, 'Springfield Health & Rehab'); // not rated sorts last
  const five = await nursingHomeSearch(f, { state: 'VT', min_overall_rating: 5, sort: 'name' });
  assert.deepEqual(five.facilities.map((x) => x.name), ['Birchwood Terrace Rehab & Healthcare', 'Gill Odd Fellows Home of Vermont', 'Maple Lane Nursing Home',
    'Pine Heights at Brattleboro Center for Nursing & R', 'Rutland Healthcare & Rehabilitation Center', 'Wake Robin-Linden Nursing Home']);
  assert.equal(five.found_before_filters, 33);
  const noAbuse = await nursingHomeSearch(f, { state: 'VT', exclude_abuse_icon: true, limit: 50 });
  assert.equal(noAbuse.total, 30);
});

test('ratings for CCN 475014: stars, staffing against VT and US averages, deficiencies by severity, fines', async () => {
  const r = await nursingHomeRatings(f, { ccn: '475014' });
  const d = r.facility;
  assert.equal(d.name, 'Premier Rehab and Healthcare at Burlington');
  assert.deepEqual(d.ratings, { overall: 1, health_inspection: 1, staffing: 2, quality_measures: 3, long_stay_quality: 3, short_stay_quality: 3 });
  assert.equal(d.special_focus_status, 'SFF Candidate'); assert.equal(d.abuse_icon, false);
  assert.equal(d.staffing.total_nurse_hours_per_resident_day, 3.96); assert.equal(d.staffing.rn_hours_per_resident_day, 0.52); assert.equal(d.staffing.nursing_staff_turnover_pct, 75.2);
  assert.equal(d.inspections.last_standard_inspection, '2025-12-17'); assert.equal(d.inspections.cycle_1_health_deficiencies, 13);
  assert.deepEqual(d.penalties_3_years, { fines: 3, fines_total_usd: 57727, payment_denials: 0, total_penalties: 3 });
  assert.equal(d.phone, '(802) 658-4200');
  assert.equal(r.state_average.total_nurse_hours_per_resident_day, 4.3); assert.equal(r.us_average.total_nurse_hours_per_resident_day, 3.9); assert.equal(r.us_average.nursing_staff_turnover_pct, 45.3);
  assert.deepEqual(r.penalties.map((p) => [p.date, p.fine_usd]), [['2026-03-17', 12438], ['2025-12-12', 32760], ['2024-05-29', 12529]]);
  assert.equal(r.deficiencies_total, 35); assert.equal(r.deficiencies_causing_harm, 6); assert.equal(r.deficiencies_immediate_jeopardy, 0);
  assert.deepEqual(r.recent_deficiencies.slice(0, 2).map((x) => [x.survey_date, x.tag, x.scope_severity]), [['2026-07-08', 'F0558', 'D'], ['2026-03-17', 'F0689', 'G']]);
  assert.equal(r.recent_deficiencies.length, 10);
  assert.match(r.summary, /overall 1 of 5 stars; health inspections 1, staffing 2, quality measures 3 \(long-stay 3, short-stay 3\)\. SFF Candidate\./);
  assert.match(r.summary, /Nurse staffing 3\.96 hours per resident per day \(Vermont 4\.3, US 3\.9\), RN 0\.52; nursing staff turnover 75\.2% \(US 45\.3%\)/);
  assert.match(r.summary, /13 health deficiencies in the latest cycle \(US average 9\.2\)\. 6 cited deficiencies caused actual harm over the last 3 cycles\./);
  assert.match(r.summary, /3 fines totaling \$57,727 in the last 3 years; latest fine \$12,438 on 2026-03-17\. CMS data of 2026-10-01\.$/);
  assert.equal(r.as_of, '2026-10-01'); assert.ok(r.more.includes(UTM));
});

test('ratings by name, and blank ratings explained by CMS footnotes 18 and 1', async () => {
  const w = await nursingHomeRatings(f, { name: 'wake robin linden', state: 'VT', deficiencies: 0 });
  assert.equal(w.facility.ccn, '475056'); assert.equal(w.recent_deficiencies.length, 0);
  const b = await nursingHomeRatings(f, { name: 'Burlington', state: 'VT' });
  assert.equal(b.facility.name, 'Elderwood at Burlington'); // contains "Burlington", sorted by name; the other is listed
  assert.deepEqual(b.other_matches.map((o) => o.ccn), ['475014']);
  const sff = await nursingHomeRatings(f, { ccn: '15463' });
  assert.equal(sff.facility.ratings.overall, null);
  assert.deepEqual(sff.facility.rating_notes, ['Overall: Not rated: this nursing home has a history of serious quality issues and is in the Special Focus Facility program.']);
  assert.match(sff.summary, /overall not rated/);
  const nu = await nursingHomeRatings(f, { ccn: '045480' });
  assert.match(nu.facility.rating_notes[0], /^Overall: Newly certified nursing home/);
});

test('compare: leaders on each measure', async () => {
  const c = await nursingHomeCompare(f, { facilities: [{ ccn: '475014' }, { name: 'Birchwood Terrace', state: 'VT' }, { ccn: '475056' }] });
  assert.deepEqual(c.facilities.map((x) => x.ccn), ['475014', '475003', '475056']);
  assert.deepEqual(c.leaders.overall, { value: 5, facilities: ['Birchwood Terrace Rehab & Healthcare', 'Wake Robin-Linden Nursing Home'] });
  assert.deepEqual(c.leaders.most_nurse_hours, { value: 6.24, facilities: ['Wake Robin-Linden Nursing Home'] });
  assert.deepEqual(c.leaders.lowest_turnover, { value: 50, facilities: ['Birchwood Terrace Rehab & Healthcare'] });
  assert.deepEqual(c.leaders.lowest_fines_usd, { value: 0, facilities: ['Wake Robin-Linden Nursing Home'] });
  assert.match(c.summary, /^Highest overall rating: Birchwood Terrace Rehab & Healthcare and Wake Robin-Linden Nursing Home \(5 stars\)\./);
  assert.deepEqual(Object.keys(c.state_averages).sort(), ['NATION', 'VT']);
});

test('input errors and upstream errors', async () => {
  await assert.rejects(nursingHomeSearch(f, {}), InputError);
  await assert.rejects(nursingHomeSearch(f, { county: 'Chittenden' }), InputError);
  await assert.rejects(nursingHomeSearch(f, { zip: 'abcde' }), InputError);
  await assert.rejects(nursingHomeSearch(f, { zip: '99999' }), InputError);
  await assert.rejects(nursingHomeSearch(f, { latitude: 44.4 }), InputError);
  await assert.rejects(nursingHomeSearch(f, { state: 'VT', sort: 'distance' }), InputError);
  await assert.rejects(nursingHomeRatings(f, { ccn: '999999' }), InputError);
  await assert.rejects(nursingHomeRatings(f, { name: 'ab' }), InputError);
  await assert.rejects(nursingHomeRatings(f, { name: 'no such home anywhere', state: 'VT' }), InputError);
  await assert.rejects(nursingHomeCompare(f, { facilities: [{ ccn: '475014' }] }), InputError);
  await assert.rejects(nursingHomeCompare(f, { facilities: [{ ccn: '475014' }, { ccn: '475014' }] }), InputError);
  await assert.rejects(nursingHomeRatings(async () => '{"message":"JSON Schema validation failed."}', { ccn: '475014' }), UpstreamError);
  await assert.rejects(nursingHomeRatings(async () => '<HTML>Access Denied</HTML>', { ccn: '475014' }), UpstreamError);
  await assert.rejects(nursingHomeRatings(async () => { throw new Error('HTTP 503'); }, { ccn: '475014' }), UpstreamError);
});

test('stdio: initialize, tools/list with annotations and a tools/call error over JSON-RPC (offline)', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'nursing-home-ratings-medicare-care-compare-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const tools = (await got(2)).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['nursing_home_search', 'nursing_home_ratings', 'nursing_home_compare']);
  for (const t of tools) { assert.ok(t.title); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, true); }
  send({ id: 3, method: 'tools/call', params: { name: 'nursing_home_search', arguments: {} } });
  const r3 = await got(3);
  child.kill();
  assert.equal(r3.result?.isError ?? Boolean(r3.error), true);
});
