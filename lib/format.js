// Small shared formatters, importable from client or server components.
//
// House rule for everything here: TIDY, NEVER MANGLE. If the input isn't
// clearly the shape we expect, hand it back exactly as typed. A formatter that
// guesses turns "Apt 3B, rear" into nonsense, and a family who watches the site
// rewrite their own address stops trusting the rest of the form. All of these
// run on BLUR, never on keystrokes -- reformatting under a moving cursor is
// maddening.

// Tidy a US phone number into (423) 200-6158. Only a clean 10-digit (or
// 1-plus-10) number is reformatted; anything else -- an extension, a foreign
// number, half-typed digits -- is returned exactly as entered.
export function formatPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

// US states, DC, and the territories/military codes the Postal Service uses.
// A dropdown rather than a text box is the single highest-value address check
// there is: it makes the most common bad value -- a missing, misspelled or
// invented state -- impossible to enter, for free, with no third party.
export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'], ['GU', 'Guam'],
  ['AS', 'American Samoa'], ['MP', 'Northern Mariana Islands'],
  ['AA', 'Armed Forces Americas'], ['AE', 'Armed Forces Europe'],
  ['AP', 'Armed Forces Pacific'],
];

const STATE_CODES = new Set(US_STATES.map(([c]) => c));
const STATE_BY_NAME = new Map(US_STATES.map(([c, n]) => [n.toLowerCase(), c]));

// Accept what someone types and return the two-letter code when it is
// unambiguous: "tn", "TN", "Tennessee", "tennessee ". Anything else comes back
// untouched, so an odd value is preserved rather than silently blanked.
export function formatStateCode(raw) {
  const s = (raw || '').trim();
  if (!s) return raw;
  const up = s.toUpperCase();
  if (up.length === 2 && STATE_CODES.has(up)) return up;
  const byName = STATE_BY_NAME.get(s.toLowerCase());
  return byName ?? raw;
}

// ZIP: five digits, or ZIP+4 with the hyphen the Postal Service expects.
// "378141234" becomes "37814-1234"; "3781" (still typing) is left alone.
export function formatZip(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 5) return digits;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return raw;
}

// True when a ZIP looks postable. Used for a gentle inline hint, never to block
// a save -- an empty box is fine, a half-typed one is the family's business.
export function zipLooksValid(raw) {
  const s = (raw || '').trim();
  return s === '' || /^\d{5}(-\d{4})?$/.test(s);
}

// Gentle case repair for a city or a name typed with a stuck caps-lock or in a
// hurry: "MORRISTOWN" and "morristown" both become "Morristown", but anything
// already mixed-case is left exactly alone -- that rule is what keeps
// "McMinnville", "LaFollette" and "St. Louis" safe from being "corrected".
export function tidyCity(raw) {
  const s = (raw || '').trim();
  if (!s) return raw;
  const isAllUpper = s === s.toUpperCase();
  const isAllLower = s === s.toLowerCase();
  if (!isAllUpper && !isAllLower) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'.])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

// A deliberately LOOSE email check: something@something.tld, nothing more.
//
// Stricter validation is a trap. Real addresses contain apostrophes, plus
// signs, long new TLDs and single-character labels, and every "smart" regex
// eventually refuses one of them. The cost of a false refusal here is a family
// who cannot register; the cost of letting a typo through is one bounced
// email. Those are not close, so this only catches the shapes that are
// definitely wrong -- no @, nothing after the dot, spaces.
export function emailLooksValid(v) {
  if (!v) return true; // blank is handled by required-ness, not by format
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
}
