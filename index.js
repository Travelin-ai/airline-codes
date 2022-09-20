const airlinesJSON = require('./airlines.json');

const getAirlineFromIATACode = (iataCode) => {
  return airlinesJSON.find((s) => s.iata === iataCode) || null;
};

const getAirlineFromICAOCode = (icaoCode) => {
  return airlinesJSON.find((s) => s.icao === icaoCode) || null;
};

module.exports = {
  getAirlineFromIATACode,
  getAirlineFromICAOCode,
};
