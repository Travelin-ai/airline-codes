const airlinesJSON = require('./airlines.json');

// A code's active holder wins. A code no one holds now (say a closed airline's, still on old
// bookings) gives its most recent holder: airlines.json lists inactive entries newest first.
const indexBy = (field) => {
  const index = new Map();
  for (const airline of airlinesJSON) {
    const code = airline[field];
    if (!code) continue;
    const known = index.get(code);
    if (!known || (airline.active === 'Y' && known.active !== 'Y')) index.set(code, airline);
  }
  return index;
};

const byIATACode = indexBy('iata');
const byICAOCode = indexBy('icao');

const getAirlineFromIATACode = (iataCode) => byIATACode.get(iataCode) || null;

const getAirlineFromICAOCode = (icaoCode) => byICAOCode.get(icaoCode) || null;

module.exports = {
  getAirlineFromIATACode,
  getAirlineFromICAOCode,
};
