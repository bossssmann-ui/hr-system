import 'i18next'

import type { defaultNS } from './index'

// We intentionally do NOT declare the strict `resources` type for
// `CustomTypeOptions` because the recruiter/HR pages use:
//   - dynamic keys from API enums (e.g. ``t(`status.${status}`)``)
//   - cross-namespace lookups via the `ns:key` shorthand
// Both patterns are runtime-safe (we have a key-parity test in
// `web/tests/i18n.test.ts`), but defeat the strict template-literal
// key inference. Keeping `defaultNS` typed preserves the default-ns
// behaviour without forcing every call to be a string-literal union.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS
  }
}
