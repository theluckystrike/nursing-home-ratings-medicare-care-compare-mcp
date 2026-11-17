# Data sources

All data is read at call time from the CMS Provider Data Catalog datastore API on data.cms.gov, the data behind Medicare.gov Care Compare. No key is needed. CMS refreshes the nursing home datasets monthly; every row carries its `processing_date`, reported as `as_of`.

| Dataset | Id | Used for |
| --- | --- | --- |
| Provider Information | `4pq5-n9py` | one row per facility: star ratings and footnotes, staffing hours, turnover, inspection cycle totals, fines, abuse icon, Special Focus status, ownership, chain, latitude and longitude |
| Penalties | `g6vv-u9sr` | fines and payment denials of the last 3 years |
| Health Deficiencies | `r5ix-sfxw` | each cited deficiency with its tag, category, scope and severity code and correction date |
| State US Averages | `xcdc-v8bm` | state and national averages for ratings, staffing, turnover, deficiencies and fines |

Endpoint: `https://data.cms.gov/provider-data/api/1/datastore/query/<id>/0` with `conditions`, `properties` and `limit` (at most 1500 rows a page).

Scope and severity codes: A-C no actual harm with minimal potential for harm; D-F no actual harm with potential for more than minimal harm; G-I actual harm; J-L immediate jeopardy to resident health or safety. Within each group the letters mean isolated, pattern and widespread.

CMS Care Compare data is a U.S. government work and is in the public domain.
