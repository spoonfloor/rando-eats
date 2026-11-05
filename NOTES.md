# Data source research: an exhaustive list of SF restaurants

Checked 2026-11-04 against the live Socrata API. Counts will drift.

> **Domain moved:** `data.sfgov.org` now 301-redirects to **`data.sf.gov`**. Call `https://data.sf.gov/resource/<id>.json` directly. No app token is needed at this volume.

## 1. DPH Health Inspection Scores (2024–Present): `tvy3-wexg`

There is no “2023–present” dataset. This one starts 2024-01-02. Earlier years are in `5tti-66ds` (2020–2023) and `pyih-qa8i` (2016–2019).

One row per inspection, ~23k rows. Relevant fields:
`permit_number`, `dba`, `permit_type`, `street_address`, `street_address_clean`, `inspection_date`, `inspection_type`, `facility_rating_status` (Pass / Conditional Pass / Closure), `latitude`, `longitude`, `analysis_neighborhood`, `supervisor_district`.

**Facility type: yes.** `permit_type` holds DPH’s permit code plus a label. The restaurant codes are:
- `H24`: restaurant under 1,000 sqft
- `H25`: restaurant 1,000–2,000 sqft
- `H26`: restaurant over 2,000 sqft

Some codes end in `R` (e.g. `H24R`). The same permit flips between `H24` and `H24R` across inspections, so strip the `R`. The other codes separate out cleanly: markets (H03–H09, H80–H83), bars with no food (H86), bars with food (H87), take-outs (H28), fast food (H29), bakeries (H88), caterers (H74, H30, J07), employee cafeterias (H84, H85), school cafeterias (H90, H91, and “PUBLIC SCHOOL CAFETERIA…”), stadium concessions (H36), and others. Coffee shops hold H24/H25 permits (Andytown and Starbucks, for example), so they count as restaurants.

**Unique facilities (distinct `permit_number`):**

| Window | All permit types | H24–H26 restaurants | + H28, H29, H87, H88 |
|---|---|---|---|
| Last 12 months | 2,679 | 1,682 | 1,824 |
| Last 24 months | 6,793 | 3,503 | 3,833 |
| All of 2024–present | 8,741 | **4,333** | 4,756 |

⚠️ **Inspection volume fell ~75% after June 2025**: about 1,000 inspections a month before, about 250 a month since. A 12-month window therefore misses most restaurants, so DPH data can’t be used alone as a list of what is open now. It also includes places that have since closed. One row has a bogus 2031 date, and 152 rows have no lat/long.

```
# distinct restaurant permits
https://data.sf.gov/resource/tvy3-wexg.json?$select=count(distinct permit_number)&$where=inspection_date <= '2026-11-05' AND (starts_with(permit_type,'H24') OR starts_with(permit_type,'H25') OR starts_with(permit_type,'H26'))
```

## 2. Registered Business Locations: `g8m3-pdis`

About 369k rows, one per business *location*. Relevant fields:
`uniqueid`, `certificate_number`, `ttxid`, `dba_name`, `ownership_name`, `full_business_address`, `city`, `business_zip`, `location_start_date`, `location_end_date`, `dba_end_date`, `administratively_closed`, `self_reported_naics_code`, **`lic`**, `lic_code_description`, `location` (point), `neighborhoods_analysis_boundaries`, `supervisor_district`.

- **NAICS changed on 2026-07-06 (Prop M).** `self_reported_naics_code` is now whatever the business typed in. It ranges from 2 to 6 digits (`72`, `722`, `7220`, `722511`, …), and the description columns are deprecated.
- **`lic` is the key field.** It lists the DPH permit codes the location holds, space-separated (e.g. `D04R D47R H24R`). In effect, the registry already contains the “has a restaurant health permit” signal.
- **“Inside SF”:** `neighborhoods_analysis_boundaries IS NOT NULL` means the point was geocoded inside an SF neighborhood polygon. That is more reliable than matching `city` text, which includes values like “S San Fran”.
- **“Active”:** `location_end_date IS NULL AND dba_end_date IS NULL`. `administratively_closed` was empty on every row checked.

| Filter (active and inside SF) | Count |
|---|---|
| NAICS starts with `722` | 5,479 |
| `lic` contains H24, H25 or H26 | **3,666** (3,522 distinct addresses) |
| Both | 2,568 |

NAICS 722 is noisy. 1,715 of those rows have no `lic` at all; examples include food trucks (722330), caterers (722320) and corporate cafés (722300). It also includes bars (722410) and food-service contractors (722310). On the other side, 454 rows with a restaurant `lic` have no NAICS code entered.

```
# active restaurant-permit locations inside SF (returns 3,666)
https://data.sf.gov/resource/g8m3-pdis.json?$select=count(*)&$where=location_end_date IS NULL AND dba_end_date IS NULL AND neighborhoods_analysis_boundaries IS NOT NULL AND (lic like '%H24%' OR lic like '%H25%' OR lic like '%H26%')
```

There is also a saved view, “Active Food Services” (`q484-t4an`), built from `g8m3-pdis`. I didn’t rely on it because its filter isn’t exposed in the metadata.

## 3. Joining the two

- **No shared ID.** DPH `permit_number` values (e.g. `H2406732783`, `06744403`) never show up in `certificate_number`, `ttxid` or `uniqueid`.
- **Address join** (house number, street, suffix; suite numbers dropped): **3,874 of 4,333** DPH restaurant permits match an active registry row inside SF, and 3,701 of those matched rows carry a restaurant `lic`. Adding a geo + name fallback (within 60 m and the first 4 letters of the name match) recovers only 22 more.
- Of the ~437 still unmatched, about 350 were last inspected more than 12 months ago and are probably closed. The ~88 inspected recently sit at multi-tenant addresses the registry writes differently, such as the Ferry Building (“THE EMBARCADERO & MARKET ST”) and Japan Center (1581 Webster).
- In the other direction, 3,406 of the 3,666 registry restaurant-`lic` rows have an address DPH inspected since 2024.

**Estimated overlap (appear in both): about 3,400–3,700 restaurants.**

## 4. Mobile Food Facility Permit: `rqzj-sfat`

Only ~22 vendors with APPROVED permits, covering ~170 location permits. Many are generic catering trucks, and every approved permit expires 2026-11-15. **Not worth including.**

## Recommendation (adopted 2026-11-04, not widened)

**Definition: in this app, “a restaurant” is an SF Business Registry location that is open (no end date), was geocoded inside SF city limits, and holds a DPH restaurant health permit (H24, H25 or H26), meaning a sit-down or counter-service place of any size, coffee shops included.** Excluded: markets, bars without food, caterers, cafeterias, stadium concessions and food trucks.

Filtering approach:
1. **Primary list: the registry query above (~3,666 rows).** It is one query with no fuzzy join. It already includes the health-permit check through `lic`, and it is the only source that records closures (`location_end_date`).
2. **Dedupe** by normalized address + name, since one location can have several rows (about 3,500 unique).
3. **Optional extra closure check:** drop entries whose address has a DPH `Closure` as its latest status, or flag entries with no DPH inspection since 2024 (~260). I wouldn’t use DPH recency as a hard filter, given the 2025 slowdown in inspections.
4. **Optional widening:** add `H28` take-out, `H29` fast food, `H87` bars with food and `H88` bakeries for roughly +10%. This is a product decision for you.

Open risk: closures only show up in the registry once the owner files them, so some dead listings will slip through. Address normalization also needs care at the Ferry Building and in malls.
