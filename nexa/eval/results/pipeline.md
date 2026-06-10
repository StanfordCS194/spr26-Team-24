# Image-pipeline verification report

End-to-end run of the REAL Nexa pipeline per image — **stops short of submit, nothing is posted**.

- Ran at: 2026-06-10T07:06:14.796Z
- Classification mode: **offline (provided classification — no LLM keys)**
- Images: 3
- Submission performed: **NONE** (no Open311 POST, no email send, no DB write)

## pothole-paloalto

> Real team test photo, no EXIF GPS -> location SOURCE is the provided coordinate. Palo Alto pothole routes to Palo Alto 311 (WEB_FORM, unambiguous).

- **Image:** `test-photos/pothole-1.jpg`
- **Preprocess:** 800×533 → 800×533, 116138 bytes; EXIF GPS present: false
- **Classification (provided (no LLM keys)):** ROAD_DAMAGE
- **Description:** Deep pothole in the right lane near the crosswalk, roughly 40cm wide and a hazard to cyclists.
- **Location:** 37.36378, -122.19389 — source: **provided**
- **Address (provided):** Page Mill Rd & El Camino Real, Palo Alto, CA
- **Jurisdiction:** city-palo-alto
- **Agency:** Palo Alto 311
- **Intake method:** WEB_FORM

**Assembled would-be payload (NOT submitted):**

| Field | Required | Value | Hint |
| --- | --- | --- | --- |
| description | yes | Deep pothole in the right lane near the crosswalk, roughly 40cm wide and a hazard to cyclists. |  |
| location_address | yes | Page Mill Rd & El Camino Real, Palo Alto, CA |  |
| latitude | no | 37.36378 |  |
| longitude | no | -122.19389 |  |
| photo | no | _(unfilled)_ | Attach the photo you uploaded to Nexa. |
| contact_email | no | reporter@example.com |  |

- **Readiness:** READY — WEB_FORM intake reached; all required fields filled (NOT submitted).
- **Would submit to:** Palo Alto 311 — **submitted: false**

## dumping-menlopark-api

> Menlo Park dumping routes AMBIGUOUSLY (ACT web form + SeeClickFix Open311). Exercises disambiguation candidates and the real Open311 GeoReport v2 buildRequestParams payload for the API candidate.

- **Image:** `test-photos/illegal-dumping-1.jpg`
- **Preprocess:** 800×600 → 800×600, 127369 bytes; EXIF GPS present: false
- **Classification (provided (no LLM keys)):** ILLEGAL_DUMPING
- **Description:** Old tires and bags of household trash dumped along the creek path overnight.
- **Location:** 37.42467, -122.21866 — source: **provided**
- **Address (provided):** Bay Rd near Marsh Rd, Menlo Park, CA
- **Jurisdiction:** city-menlo-park
- **Agency:** Menlo Park SeeClickFix (Open311) *(ambiguous routing — disambiguated)*
- **Intake method:** API
- **Disambiguation:** More than one office handles this here. Which should we file your report with?
- **Candidates:** Menlo Park ACT (WEB_FORM), Menlo Park SeeClickFix (Open311) (API)

**Assembled would-be payload (NOT submitted):**

Open311 POST → `https://seeclickfix.com/open311/v2/requests.json` (service_code: `94210`)

```json
{
  "service_code": "94210",
  "description": "Old tires and bags of household trash dumped along the creek path overnight.",
  "lat": "37.42467",
  "long": "-122.21866",
  "address_string": "Bay Rd near Marsh Rd, Menlo Park, CA"
}
```

- **Readiness:** READY — Open311 GeoReport v2 body fully assembled (NOT posted).
- **Would submit to:** Menlo Park SeeClickFix (Open311) — **submitted: false**

## emissions-paloalto-phone

> Smoking-vehicle report routes to the CARB Smoking Vehicle Complaint (PHONE hotline). Exercises the prefill copy-over guide for a non-API intake method.

- **Image:** `test-photos/exhaust-smoke-1.jpg`
- **Preprocess:** 800×533 → 800×533, 76093 bytes; EXIF GPS present: false
- **Classification (provided (no LLM keys)):** VEHICLE_EMISSIONS
- **Description:** Sedan emitting heavy blue/black smoke while idling at the light.
- **Location:** 37.36378, -122.19389 — source: **provided**
- **Address (provided):** University Ave & Middlefield Rd, Palo Alto, CA
- **Jurisdiction:** city-palo-alto
- **Agency:** CARB Smoking Vehicle Complaint
- **Intake method:** PHONE

**Assembled would-be payload (NOT submitted):**

| Field | Required | Value | Hint |
| --- | --- | --- | --- |
| license_plate | yes | 37.36378 |  |
| vehicle_make | yes | _(unfilled)_ | You'll need to fill this in. |
| observation_location | yes | University Ave & Middlefield Rd, Palo Alto, CA |  |
| observation_datetime | yes | 6/10/2026, 12:06:14 AM |  |
| contact_phone | no | (800) 242-4450 |  |
| vehicle_model | no | _(unfilled)_ | You'll need to fill this in. |
| vehicle_color | no | _(unfilled)_ | You'll need to fill this in. |

- **Readiness:** NOT READY — Required field(s) not populated: vehicle_make.
- **Would submit to:** CARB Smoking Vehicle Complaint — **submitted: false**

