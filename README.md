# Airline Codes
> Airline codes (IATA, ICAO, ticket prefix) and names from OpenTravelData

## Install

```
npm install "@travelin-ai/airline-codes@git+https://github.com/Travelin-ai/airline-codes.git#semver:^2.0.1"
```

This installs the newest tagged release in the range. [Releases](#releases) explains the tags.
The package is named `@travelin-ai/airline-codes`, as the unscoped `airline-codes` on npm is an unrelated package.

## Usage

```javascript
const { getAirlineFromIATACode, getAirlineFromICAOCode } = require('@travelin-ai/airline-codes');

getAirlineFromIATACode('LH');
// => { id: 'air-lufthansa-v1', name: 'Lufthansa', alias: '', iata: 'LH', icao: 'DLH',
//      callsign: '', country: '', active: 'Y', numeric: '220' }

getAirlineFromICAOCode('DLH'); // => the same entry
getAirlineFromIATACode('$$');  // => null for an unknown or empty code
```

If you'd like the whole list, import the JSON directly:

```javascript
const airlines = require('@travelin-ai/airline-codes/airlines.json');
```

### Fields

Every field is a string, and an empty string means unknown.

- `id`: the OpenTravelData key, such as `air-lufthansa-v1`. Entries this repo adds start with `travelin-`.
- `name`: the airline's name.
- `alias`: empty, unless `overrides.json` gives the airline a shorter name to show.
- `iata`: the two-character IATA code. It is empty for airlines that only have an ICAO code.
- `icao`: the three-letter ICAO code.
- `numeric`: the three-digit IATA ticket prefix (accounting code), such as `220` for Lufthansa.
- `active`: `Y` for the one airline that holds a code today, `N` for everything else.
  - Each IATA code has at most one active airline.
  - Airlines that closed or gave up their code stay in the list as `N`, so old bookings can still be named.
  - Cargo and rail carriers can be active. Booking systems (`1A`, `1S`), technology companies and alliances never are.
- `callsign`, `country`: OpenTravelData doesn't publish these, so they are always empty. They are kept so the entry shape stays the same.

### Lookups

A lookup returns a code's active airline. When no one holds the code today, it returns the most
recent airline that did: `getAirlineFromIATACode('OG')` gives Fly Play, which stopped flying in 2025, with `active: 'N'`.

## Update the list

```
npm run generate
npm test
```

`npm run generate` needs Node 18 or later, as it uses `fetch`. It:

1. Downloads OpenTravelData's [`optd_airlines.csv`](https://github.com/opentraveldata/opentraveldata/blob/master/opentraveldata/optd_airlines.csv) and saves it as the `optd_airlines.csv` snapshot here, so upstream changes show in the diff.
2. Picks the current holder of each IATA code from each row's validity dates.
3. Applies `overrides.json`.
4. Writes `airlines.json` and `snapshot.json`, the snapshot's download date and the date it built the list for.

It then prints:

- each code that more than one current carrier claims, with the one it picked;
- overrides that OpenTravelData now matches;
- every active code that was added, removed or renamed.

Read the report before you commit.

A run builds and checks everything in memory first. Only then does it write the files, each through a temp file and rename, so a failed or interrupted run leaves the committed files as they were.
A run that would leave more than 1% of the active codes without a holder stops without writing anything, because that is what a truncated download looks like. Validity dates alone end about five codes a year.

- `node generate.js --offline` rebuilds from the committed snapshot without downloading, for example after editing `overrides.json`.
- `--date 2026-11-18` builds the list as of another date.
- `--allow-mass-removal` accepts a run that removes more than 1% of the active codes, when the removals are real.

Never edit `airlines.json` by hand. A test fails when it differs from what `generate.js` builds.

OpenTravelData updates its airlines about monthly, so refresh every month or two, and whenever an airline shows the wrong name.
Fixes that belong upstream can also go to OpenTravelData as an [issue or pull request](https://github.com/opentraveldata/opentraveldata).

### How the holder of a code is picked

A row holds its code today when it has no `env_id` (which marks an obsolete version), and today falls inside its `validity_from` to `validity_to` dates (an empty date means open-ended).

When several such rows share a code, the first of these rules that separates them decides:

1. A carrier with a ticket prefix wins.
2. A passenger airline wins over cargo, and cargo over rail.
3. The newest start date wins.
4. The most flights wins (`flt_freq`).

### Manual corrections

`overrides.json` is a list of corrections applied on every run. Each one needs a `reason` saying why it exists. It also needs either an `id` or an `iata`:

- `id` matches that exact entry. If no entry has the id, the override adds a new entry, which needs a `name` and an `iata` or `icao`.
- `iata` matches the code's active airline. It is an error when no one holds the code; match by `id` instead.

Any other fields in an override replace the entry's values. Setting `"active": "Y"` makes that entry the code's holder and the others inactive.

```json
[
  {
    "reason": "Travelin shows Norwegian as Norwegian Air.",
    "iata": "DY",
    "name": "Norwegian Air"
  }
]
```

## Releases

The apps install a range of tagged versions, not `main`, so a merge reaches them only once it is tagged and someone updates them. Every merge to `main` needs a tag.

1. In the pull request, raise `version` in `package.json`:
   - patch for a data refresh or a name fix;
   - minor for a new field;
   - major when a field changes meaning or goes away.
2. After the merge, tag the merge commit on `main` with the version and the pull request:

   ```
   git checkout main && git pull
   git tag -a v2.0.0 -m "v2.0.0: build the list from OpenTravelData (PR #2)"
   git push origin v2.0.0
   ```

3. An app depends on a range of those tags:

   ```json
   "@travelin-ai/airline-codes": "git+https://github.com/Travelin-ai/airline-codes.git#semver:^2.0.1"
   ```

   `npm ci` installs the version in the app's lockfile, and `npm update @travelin-ai/airline-codes` moves the app to the newest tag in its range. A new major version needs the range changed by hand.

## Data license

The airline data comes from [OpenTravelData](https://github.com/opentraveldata/opentraveldata) and is used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This repo changes it:

- it reshapes the rows into the fields above;
- it marks one active airline per code;
- it applies the corrections in `overrides.json`.

The code in this repo is under the ISC license.

## Thanks

- [OpenTravelData](https://github.com/opentraveldata/opentraveldata)
- [Andrew Kennedy](https://github.com/akenn/airport-codes)
- [Ram Nadella](https://github.com/ram-nadella/airport-codes)
- [Jani Patokallio](https://github.com/jpatokal/openflights/)
