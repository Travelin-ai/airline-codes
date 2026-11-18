#!/usr/bin/env node
'use strict';

/**
 * Regenerates airlines.json from Open Travel Data's optd_airlines.csv and overrides.json.
 *
 * Usage:
 *   npm run generate                       download the latest OPTD file, then build
 *   node generate.js --offline             build from the committed optd_airlines.csv
 *   node generate.js --date 2026-11-18     decide who holds each code as of this date
 *
 * README.md explains how the holder of a code is picked and how overrides.json works.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_URL =
  'https://raw.githubusercontent.com/opentraveldata/opentraveldata/master/opentraveldata/optd_airlines.csv';
const SNAPSHOT_PATH = path.join(__dirname, 'optd_airlines.csv');
const SNAPSHOT_INFO_PATH = path.join(__dirname, 'snapshot.json');
const OVERRIDES_PATH = path.join(__dirname, 'overrides.json');
const OUTPUT_PATH = path.join(__dirname, 'airlines.json');

const OPTD_COLUMNS = [
  'pk', 'env_id', 'validity_from', 'validity_to', '3char_code', '2char_code',
  'num_code', 'name', 'type', 'flt_freq',
];
const FIELDS = ['id', 'name', 'alias', 'iata', 'icao', 'callsign', 'country', 'active', 'numeric'];

// OPTD `type` is blank on most rows. These kinds are not carriers, so they never hold a code:
// booking systems (G), technology and other companies (T) and Amadeus dummy codes (D).
const NEVER_ACTIVE_TYPES = new Set(['G', 'T', 'D']);
// Passenger kinds (blank, P, PC, PT, F) rank before cargo, and cargo before rail.
const TYPE_RANK = { C: 1, CT: 1, R: 2 };
const OPEN_ENDED = '9999-12-31';

function parseOptd(text) {
  const lines = text.split(/\r?\n/).filter((line) => line !== '');
  const header = lines[0].split('^');
  const missing = OPTD_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length) throw new Error(`optd_airlines.csv lacks the columns ${missing.join(', ')}`);
  // OPTD fields are never quoted or escaped, so a plain split is safe.
  return lines.slice(1).map((line, index) => {
    const values = line.split('^');
    if (values.length !== header.length) {
      throw new Error(
        `optd_airlines.csv line ${index + 2} has ${values.length} fields instead of ${header.length}`
      );
    }
    return Object.fromEntries(header.map((column, i) => [column, values[i]]));
  });
}

// OPTD writes 3-digit ticket prefixes without leading zeros ("20" for 020) and 0 for none.
const formatNumeric = (code) => (/^\d{1,3}$/.test(code) && Number(code) > 0 ? code.padStart(3, '0') : '');

const isCurrent = (row, asOf) =>
  !row.env_id &&
  (!row.validity_from || row.validity_from <= asOf) &&
  (!row.validity_to || row.validity_to >= asOf);

function toRecord(row, asOf) {
  return {
    entry: {
      id: row.pk,
      name: row.name.trim(),
      alias: '',
      iata: row['2char_code'],
      icao: row['3char_code'],
      callsign: '',
      country: '',
      active: 'N',
      numeric: formatNumeric(row.num_code),
    },
    type: row.type,
    current: isCurrent(row, asOf),
    from: row.validity_from,
    // An obsolete OPTD version without an end date ended at an unknown time, so it sorts as oldest.
    to: row.validity_to || (row.env_id ? '' : OPEN_ENDED),
    flightFrequency: Number(row.flt_freq) || 0,
  };
}

// When two current carriers share a code, the one with a ticket prefix wins, as a carrier that
// issues tickets is the one a booking names. Then passenger over cargo over rail, then the
// newest start, then the most flights.
const compareCandidates = (a, b) =>
  Boolean(b.entry.numeric) - Boolean(a.entry.numeric) ||
  (TYPE_RANK[a.type] || 0) - (TYPE_RANK[b.type] || 0) ||
  b.from.localeCompare(a.from) ||
  b.flightFrequency - a.flightFrequency ||
  a.entry.id.localeCompare(b.entry.id);

// Marks one current carrier per IATA code active and returns the codes that had several.
function pickHolders(records) {
  const candidatesByCode = new Map();
  for (const record of records) {
    if (!record.entry.iata || !record.current || NEVER_ACTIVE_TYPES.has(record.type)) continue;
    const candidates = candidatesByCode.get(record.entry.iata) || [];
    candidates.push(record);
    candidatesByCode.set(record.entry.iata, candidates);
  }
  const shared = [];
  for (const [code, candidates] of candidatesByCode) {
    candidates.sort(compareCandidates);
    candidates[0].entry.active = 'Y';
    if (candidates.length > 1) shared.push({ code, candidates });
  }
  return shared;
}

function applyOverrides(records, overrides) {
  const unchanged = [];
  const pinnedCodes = new Map();
  overrides.forEach((override, index) => {
    const label = `overrides.json entry ${index} (${override.id || override.iata})`;
    const unknownKeys = Object.keys(override).filter((key) => key !== 'note' && !FIELDS.includes(key));
    if (unknownKeys.length) throw new Error(`${label} has unknown keys: ${unknownKeys.join(', ')}`);
    if (!override.note) throw new Error(`${label} needs a "note" saying why it exists`);
    for (const field of FIELDS) {
      if (field in override && typeof override[field] !== 'string') {
        throw new Error(`${label}: "${field}" must be a string`);
      }
    }

    let target;
    if (override.id) {
      target = records.find((record) => record.entry.id === override.id);
    } else if (override.iata) {
      target = records.find((record) => record.entry.iata === override.iata && record.entry.active === 'Y');
      if (!target) throw new Error(`${label}: no airline holds ${override.iata}, so match an entry by "id"`);
    } else {
      throw new Error(`${label} needs an "id" or an "iata"`);
    }

    if (!target) {
      if (!override.name || !(override.iata || override.icao)) {
        throw new Error(`${label}: no entry has this id, and a new entry needs a name and an iata or icao`);
      }
      const entry = Object.fromEntries(FIELDS.map((field) => [field, field === 'active' ? 'N' : '']));
      target = { entry: { ...entry, id: override.id }, from: '', to: OPEN_ENDED, added: true };
      records.push(target);
    }

    const changes = FIELDS.filter((field) => field !== 'id' && field in override && target.entry[field] !== override[field]);
    if (!target.added && changes.length === 0) unchanged.push(label);
    for (const field of changes) target.entry[field] = override[field];

    if (override.active === 'Y') {
      const code = target.entry.iata;
      if (pinnedCodes.has(code)) throw new Error(`${label} and ${pinnedCodes.get(code)} both make ${code} active`);
      pinnedCodes.set(code, label);
      for (const record of records) {
        if (record !== target && record.entry.iata === code) record.entry.active = 'N';
      }
    }
  });
  return { unchanged, pinnedCodes };
}

function validate(entries) {
  const problems = [];
  const ids = new Set();
  const activeCodes = new Map();
  for (const entry of entries) {
    if (ids.has(entry.id)) problems.push(`${entry.id}: the id is used twice`);
    ids.add(entry.id);
    if (!entry.name || entry.name.includes('\\N')) problems.push(`${entry.id}: no name`);
    if (entry.iata && !/^[A-Z0-9]{2}$/.test(entry.iata)) problems.push(`${entry.id}: IATA code "${entry.iata}"`);
    if (entry.icao && !/^[A-Z]{3}$/.test(entry.icao)) problems.push(`${entry.id}: ICAO code "${entry.icao}"`);
    if (entry.numeric && !/^\d{3}$/.test(entry.numeric)) problems.push(`${entry.id}: numeric code "${entry.numeric}"`);
    if (entry.active !== 'Y' && entry.active !== 'N') problems.push(`${entry.id}: active "${entry.active}"`);
    if (entry.active === 'Y') {
      if (!entry.iata) problems.push(`${entry.id}: active without an IATA code`);
      else if (activeCodes.has(entry.iata)) problems.push(`${entry.iata}: active on ${activeCodes.get(entry.iata)} and ${entry.id}`);
      else activeCodes.set(entry.iata, entry.id);
    }
  }
  if (problems.length) throw new Error(`airlines.json would be invalid:\n  ${problems.join('\n  ')}`);
}

// Active entries first, by code. Then the rest from the most to the least recent, so the first
// entry for a code or an ICAO code is the one a lookup should name.
const compareOutput = (a, b) => {
  const aActive = a.entry.active === 'Y';
  const bActive = b.entry.active === 'Y';
  if (aActive !== bActive) return aActive ? -1 : 1;
  return (
    (aActive ? 0 : b.to.localeCompare(a.to) || b.from.localeCompare(a.from)) ||
    (a.entry.iata || '~').localeCompare(b.entry.iata || '~') ||
    a.entry.icao.localeCompare(b.entry.icao) ||
    a.entry.id.localeCompare(b.entry.id)
  );
};

/**
 * Builds the airlines.json entries from the OPTD file's text and the overrides, as of a date
 * (YYYY-MM-DD). Returns the entries and what a person refreshing the data should look at.
 */
function build({ csvText, overrides, asOf }) {
  const records = parseOptd(csvText)
    // Alliances (*A, *O, *S, *Q) are not airlines.
    .filter((row) => !row['2char_code'].startsWith('*'))
    .map((row) => toRecord(row, asOf));
  const sharedCodes = pickHolders(records);
  const { unchanged: unchangedOverrides, pinnedCodes } = applyOverrides(records, overrides);
  records.sort(compareOutput);
  const entries = records.map((record) => Object.fromEntries(FIELDS.map((field) => [field, record.entry[field]])));
  validate(entries);
  const shared = sharedCodes.map(({ code, candidates }) => ({
    code,
    holder: entries.find((entry) => entry.iata === code && entry.active === 'Y'),
    others: candidates.filter((record) => record.entry.active !== 'Y').map((record) => record.entry.name),
    pinned: pinnedCodes.has(code),
  }));
  return { entries, shared, unchangedOverrides };
}

const serialize = (entries) => `[\n${entries.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`;

function describeChanges(previous, entries) {
  const activeByCode = (list) => new Map(list.filter((a) => a.active === 'Y' && a.iata).map((a) => [a.iata, a.name]));
  const before = activeByCode(previous);
  const after = activeByCode(entries);
  const lines = [];
  for (const [code, name] of after) {
    if (!before.has(code)) lines.push(`  + ${code} ${name}`);
    else if (before.get(code) !== name) lines.push(`  ~ ${code} ${before.get(code)} -> ${name}`);
  }
  for (const [code, name] of before) if (!after.has(code)) lines.push(`  - ${code} ${name}`);
  return lines.sort((a, b) => a.slice(4).localeCompare(b.slice(4)));
}

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const dateIndex = args.indexOf('--date');
  const asOf = dateIndex === -1 ? new Date().toISOString().slice(0, 10) : args[dateIndex + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf || '')) throw new Error('--date takes a date like 2026-11-18');

  let snapshot = fs.existsSync(SNAPSHOT_INFO_PATH) ? JSON.parse(fs.readFileSync(SNAPSHOT_INFO_PATH, 'utf8')) : {};
  if (!offline) {
    console.log(`Downloading ${SOURCE_URL}`);
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    fs.writeFileSync(SNAPSHOT_PATH, await response.text());
    snapshot = { source: SOURCE_URL, downloaded: new Date().toISOString().slice(0, 10) };
  }

  const previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  const { entries, shared, unchangedOverrides } = build({
    csvText: fs.readFileSync(SNAPSHOT_PATH, 'utf8'),
    overrides: JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')),
    asOf,
  });
  fs.writeFileSync(OUTPUT_PATH, serialize(entries));
  fs.writeFileSync(SNAPSHOT_INFO_PATH, `${JSON.stringify({ ...snapshot, asOf }, null, 2)}\n`);

  const activeCount = entries.filter((entry) => entry.active === 'Y').length;
  console.log(`Wrote ${entries.length} airlines, ${activeCount} of them active, as of ${asOf}.`);
  console.log(`\nCodes with more than one current carrier (check each pick; pin another in overrides.json):`);
  for (const { code, holder, others, pinned } of shared.sort((a, b) => a.code.localeCompare(b.code))) {
    const holderName = holder ? holder.name : 'no one';
    console.log(`  ${code} ${holderName} over ${others.join(', ')}${pinned ? ' (pinned in overrides.json)' : ''}`);
  }
  if (unchangedOverrides.length) {
    console.log(`\nOverrides that OPTD now matches, which can be removed:`);
    for (const label of unchangedOverrides) console.log(`  ${label}`);
  }
  const changes = describeChanges(previous, entries);
  console.log(`\nActive codes changed: ${changes.length} (+ added, - removed, ~ renamed)`);
  for (const line of changes) console.log(line);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { build, serialize, SNAPSHOT_PATH, SNAPSHOT_INFO_PATH, OVERRIDES_PATH, OUTPUT_PATH };
