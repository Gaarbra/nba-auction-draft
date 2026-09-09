// Maps stats-service's `stats.country` (nba_api's CommonPlayerInfo COUNTRY
// field, a real value like "USA" or "Serbia", not a standard ISO list on
// its own) to a two-letter country code, then computes the flag emoji from
// that code rather than hardcoding emoji characters directly -- each
// A-Z letter has a matching "regional indicator symbol" Unicode codepoint,
// and a flag emoji is just two of them back to back. More reliable across
// editors/terminals than pasting the emoji glyph itself.
//
// Covers the countries NBA players have actually been born in (checked
// against real roster/history data, not the full ISO country list) --
// nba_api's own COUNTRY strings sometimes differ from ISO short names
// (e.g. "USA" not "United States"), so this maps the actual values rather
// than assuming a standard list would just work.
const COUNTRY_CODES = {
  USA: "US",
  Canada: "CA",
  Australia: "AU",
  Argentina: "AR",
  Bahamas: "BS",
  Brazil: "BR",
  Cameroon: "CM",
  China: "CN",
  Croatia: "HR",
  Czech_Republic: "CZ",
  "Czech Republic": "CZ",
  "Democratic Republic of the Congo": "CD",
  "Dominican Republic": "DO",
  Egypt: "EG",
  Estonia: "EE",
  Finland: "FI",
  France: "FR",
  Georgia: "GE",
  Germany: "DE",
  Ghana: "GH",
  Greece: "GR",
  Guinea: "GN",
  Israel: "IL",
  Italy: "IT",
  Jamaica: "JM",
  Japan: "JP",
  Kosovo: "XK",
  Latvia: "LV",
  Lithuania: "LT",
  Mali: "ML",
  Mexico: "MX",
  Montenegro: "ME",
  "New Zealand": "NZ",
  Nigeria: "NG",
  "North Macedonia": "MK",
  Panama: "PA",
  Poland: "PL",
  Portugal: "PT",
  "Puerto Rico": "PR",
  Russia: "RU",
  Senegal: "SN",
  Serbia: "RS",
  Slovenia: "SI",
  "South Korea": "KR",
  "South Sudan": "SS",
  Spain: "ES",
  Sudan: "SD",
  Sweden: "SE",
  Switzerland: "CH",
  Turkey: "TR",
  Ukraine: "UA",
  "United Kingdom": "GB",
  "US Virgin Islands": "VI",
  Venezuela: "VE",
};

function flagFromCode(code) {
  if (!code || code.length !== 2) return null;
  const codePoints = [...code.toUpperCase()].map((char) => 0x1f1e6 + (char.charCodeAt(0) - 65));
  return String.fromCodePoint(...codePoints);
}

export function countryFlag(countryName) {
  if (!countryName) return null;
  const code = COUNTRY_CODES[countryName];
  return code ? flagFromCode(code) : null;
}
