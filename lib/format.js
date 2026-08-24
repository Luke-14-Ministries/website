// Small shared formatters, importable from client or server components.

// Tidy a US phone number into (423) 200-6158. Only a clean 10-digit (or
// 1-plus-10) number is reformatted; anything else -- an extension, a foreign
// number, half-typed digits -- is returned exactly as entered, because
// mangling what someone typed is worse than not prettifying it. Use on blur,
// never on every keystroke: reformatting under a moving cursor is maddening.
export function formatPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
