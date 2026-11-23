const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const airlines = require('../airlines.json');
const { getAirlineFromIATACode, getAirlineFromICAOCode } = require('..');
const { build, serialize, checkRemovals, SNAPSHOT_PATH, SNAPSHOT_INFO_PATH, OVERRIDES_PATH, OUTPUT_PATH } = require('../generate');

const FIELDS = ['id', 'name', 'alias', 'iata', 'icao', 'callsign', 'country', 'active', 'numeric'];
const active = airlines.filter((airline) => airline.active === 'Y');

test('airlines.json is exactly what generate.js builds from the snapshot and overrides', () => {
  const { asOf } = JSON.parse(fs.readFileSync(SNAPSHOT_INFO_PATH, 'utf8'));
  const { entries } = build({
    csvText: fs.readFileSync(SNAPSHOT_PATH, 'utf8'),
    overrides: JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')),
    asOf,
  });
  assert.equal(fs.readFileSync(OUTPUT_PATH, 'utf8'), serialize(entries), 'airlines.json was edited by hand; put the change in overrides.json and run npm run generate');
});

test('every entry has the same string fields', () => {
  for (const airline of airlines) {
    assert.deepEqual(Object.keys(airline), FIELDS, airline.id);
    for (const field of FIELDS) assert.equal(typeof airline[field], 'string', `${airline.id} ${field}`);
    assert.ok(airline.name && !airline.name.includes('\\N'), airline.id);
  }
});

test('each code has at most one active airline, and codes are well formed', () => {
  const codes = active.map((airline) => airline.iata);
  assert.equal(new Set(codes).size, codes.length);
  for (const airline of airlines) {
    if (airline.iata) assert.match(airline.iata, /^[A-Z0-9]{2}$/, airline.id);
    if (airline.icao) assert.match(airline.icao, /^[A-Z]{3}$/, airline.id);
    if (airline.numeric) assert.match(airline.numeric, /^\d{3}$/, airline.id);
  }
  for (const junk of ['\\N', '--', '-+', ';;', '^^', '&T', '..', 'ЯП', 'МИ', 'АЯ', '-', '01', '99']) {
    assert.equal(getAirlineFromIATACode(junk), null, junk);
  }
});

test('codes that were missing or reassigned name their current holder', () => {
  const expected = {
    '4Y': 'Discover Airlines',
    XP: 'Avelo Airlines',
    JX: 'STARLUX Airlines',
    MX: 'Breeze Airways',
    QP: 'Akasa Air',
    N0: 'Norse Atlantic Airways',
    RX: 'Riyadh Air',
    RT: 'UVT Aero',
    '4O': 'Air Montenegro',
    OH: 'PSA Airlines',
  };
  for (const [code, name] of Object.entries(expected)) {
    const airline = getAirlineFromIATACode(code);
    assert.equal(airline && airline.name, name, code);
    assert.equal(airline.active, 'Y', code);
  }
});

test('codes that used to have several active airlines name the mainline one', () => {
  const expected = { G3: 'Gol Transportes Aéreos', LH: 'Lufthansa', SQ: 'Singapore Airlines', JL: 'Japan Airlines' };
  for (const [code, name] of Object.entries(expected)) {
    assert.equal(getAirlineFromIATACode(code).name, name, code);
    assert.equal(active.filter((airline) => airline.iata === code).length, 1, code);
  }
});

test('a code no one holds now names its most recent holder, inactive', () => {
  // PLAY stopped flying on 2025-09-29.
  assert.equal(getAirlineFromIATACode('OG').name, 'Fly Play');
  assert.equal(getAirlineFromIATACode('OG').active, 'N');
  assert.equal(getAirlineFromIATACode('6X').name, 'Amadeus Six');
});

test('earlier hand fixes survive a regenerate', () => {
  assert.equal(getAirlineFromIATACode('FJ').name, 'Fiji Airways');
  assert.equal(getAirlineFromIATACode('DY').name, 'Norwegian Air');
  assert.equal(getAirlineFromIATACode('D8').name, 'Norwegian Air');
});

test('ICAO lookups prefer the active airline', () => {
  assert.equal(getAirlineFromICAOCode('DLH').name, 'Lufthansa');
  assert.equal(getAirlineFromICAOCode('GEC').name, 'Lufthansa Cargo');
  assert.equal(getAirlineFromICAOCode('DLH').numeric, '220');
});

test('lookups return null for unknown or empty codes', () => {
  for (const code of ['$$', '', undefined, null]) {
    assert.equal(getAirlineFromIATACode(code), null);
    assert.equal(getAirlineFromICAOCode(code), null);
  }
});

test('build picks one holder per shared code and applies overrides', () => {
  const header = 'pk^env_id^validity_from^validity_to^3char_code^2char_code^num_code^name^type^flt_freq';
  const csvText = [
    header,
    'air-cargo^^2001-01-01^^CAR^AA^20^A Cargo^C^',
    'air-main^^1990-01-01^^MAI^AA^220^A Main^^',
    'air-old^^1980-01-01^2000-12-31^OLD^BB^100^B Old^^',
    'gds-x^^^^^1X^0^A Booking System^G^',
    'alliance^^^^^*A^^An Alliance^^',
  ].join('\n');
  const { entries } = build({
    csvText,
    overrides: [{ reason: 'rename', iata: 'AA', name: 'A' }, { reason: 'add', id: 'new-cc', iata: 'CC', name: 'C', active: 'Y' }],
    asOf: '2026-01-01',
  });
  const find = (id) => entries.find((entry) => entry.id === id);
  assert.equal(find('air-main').active, 'Y');
  assert.equal(find('air-main').name, 'A');
  assert.equal(find('air-main').numeric, '220');
  assert.equal(find('air-cargo').active, 'N');
  assert.equal(find('air-cargo').numeric, '020');
  assert.equal(find('air-old').active, 'N');
  assert.equal(find('gds-x').active, 'N');
  assert.equal(find('new-cc').active, 'Y');
  assert.equal(find('alliance'), undefined);
  assert.throws(() => build({ csvText, overrides: [{ iata: 'AA', name: 'A' }], asOf: '2026-01-01' }), /reason/);
  assert.throws(() => build({ csvText, overrides: [{ reason: 'x', iata: 'BB', name: 'B' }], asOf: '2026-01-01' }), /no airline holds BB/);
});

test('a run that leaves too many active codes without a holder stops', () => {
  // 200 active codes allow 2 removals (1%).
  const previous = Array.from({ length: 200 }, (_, i) => ({ iata: `${i}`.padStart(3, 'A'), name: `Airline ${i}`, active: 'Y' }));
  const keep = (count) => previous.slice(0, previous.length - count);
  assert.doesNotThrow(() => checkRemovals(previous, keep(2)));
  assert.throws(() => checkRemovals(previous, keep(3)), /3 active codes would lose their holder, more than 2/);
  assert.doesNotThrow(() => checkRemovals(previous, keep(3), { allowMassRemoval: true }));
  assert.doesNotThrow(() => checkRemovals(airlines, airlines));
});
