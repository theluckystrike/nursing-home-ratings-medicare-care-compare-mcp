# nursing-home-ratings-medicare-care-compare-mcp

Nursing home ratings for AI assistants: the Medicare Care Compare star ratings of every Medicare and Medicaid certified nursing home in the US, with nurse staffing hours, staff turnover, cited inspection deficiencies, fines, the abuse icon and Special Focus Facility status. Ask for the best rated nursing homes near a ZIP code, what a facility's 1-star staffing rating means, or how three homes you are touring compare.

This is a Model Context Protocol (MCP) server. It reads the CMS Provider Data Catalog on data.cms.gov, the data behind Medicare.gov Care Compare, at call time. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `nursing_home_search` | Nursing homes near a ZIP code (default 10 miles) or a point, or in a city, county or state, or by name, ranked by overall, inspection, staffing or quality stars, nurse hours or distance. Filters for a minimum overall rating, the abuse icon and Special Focus status. |
| `nursing_home_ratings` | One facility in full: overall, health inspection, staffing and quality measure stars (long-stay and short-stay) with the CMS footnote behind a blank or 1-star rating, nurse and RN hours per resident per day against state and US averages, staff turnover, recent cited deficiencies with scope and severity, fines and payment denials, ownership, chain and the Medicare.gov link. |
| `nursing_home_compare` | 2 to 5 facilities side by side: stars, staffing hours, turnover, deficiencies and fines, with the leader on each measure and the state averages. |

Every result has structured JSON, a plain-text summary, `as_of`, `source` and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=nursing-home-ratings-medicare-care-compare-mcp)). Every tool is marked read-only.

## What it knows that your model does not

- The current CMS star ratings of all 14,686 certified nursing homes, refreshed monthly by CMS, not a training-time snapshot.
- Each facility's inspection record: cited deficiencies with scope and severity (actual harm, immediate jeopardy), fines and payment denials of the last 3 years, the abuse icon and Special Focus Facility status.
- Reported nurse and RN staffing hours per resident per day, weekend staffing and staff turnover, next to the state and national averages.

## Install

### Hosted (custom connector, ChatGPT developer mode, any remote MCP client)

Paste this URL. No token, no sign-up.

```
https://nursing-home-ratings-medicare-care-compare-mcp.lipmichal.workers.dev/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "nursing-home-ratings": { "url": "https://nursing-home-ratings-medicare-care-compare-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`.

```json
{
  "servers": {
    "nursing-home-ratings": { "type": "http", "url": "https://nursing-home-ratings-medicare-care-compare-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio

The npm package is not published. Build it from this repository with Node 20 or newer, then point your MCP client at `node /path/to/nursing-home-ratings-medicare-care-compare-mcp/dist/stdio.js`.

```
git clone https://github.com/theluckystrike/nursing-home-ratings-medicare-care-compare-mcp && cd nursing-home-ratings-medicare-care-compare-mcp
npm install && npm run build
node dist/stdio.js
```

## Example prompts

- "What are the best rated nursing homes within 10 miles of ZIP 05401?"
- "Show me the Care Compare ratings, fines and recent inspection problems for Premier Rehab and Healthcare at Burlington in Vermont."
- "Compare these three nursing homes we are touring: Birchwood Terrace, Elderwood at Burlington and Wake Robin in Vermont."
- "Which nursing homes in Cook County, Illinois have 5 stars and no abuse flag?"

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- CMS Provider Data Catalog (data.cms.gov), nursing home datasets: Provider Information, Penalties, Health Deficiencies, State and US Averages: https://data.cms.gov/provider-data/topics/nursing-homes

## Limitations

- US nursing homes certified by Medicare or Medicaid only; assisted living and memory care facilities that are not certified are not in CMS data.
- CMS refreshes the data monthly, so the newest inspections and fines appear with a delay of weeks to months.
- Distance search centres a ZIP code on the nursing homes CMS lists in that ZIP (or its 4- or 3-digit prefix), not on the ZIP's exact geographic centre.
- Star ratings compare health inspections within each state. They are a starting point: visit, and ask the state long-term care ombudsman.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=nursing-home-ratings-medicare-care-compare-mcp).

Part of the Zovo MCP collection at https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

CI (`.github/workflows/bundle.yml`) runs the tests, the type check and `wrangler deploy --dry-run --outdir out`, and uploads the Worker bundle as an artifact.

## License

MIT
