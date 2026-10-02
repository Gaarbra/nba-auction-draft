# Privacy and rights review — October 2, 2026

## Implemented

- Google Analytics and optional PostHog initialize only after explicit permission. Equal-weight allow/refuse choices, withdrawal in the footer, and a 180-day preference lifetime.
- Advertising signals, PostHog autocapture and session recording are disabled. Page locations omit room invite queries and fragments.
- Privacy/cookie notices now describe reconnect storage, server-saved Classic draft results, chat delivery, hosting/security processing, external images, and optional analytics.
- Help, privacy, cookies, terms and reporting are available in accessible dialogs during play. The contact placeholder is explicitly nonfunctional; public bug reports warn against sharing personal data.
- Solo drafts no longer spend coins or feed auction-price persistence. Multiplayer retains virtual coins with no cash value.

## Requires operator follow-up

1. NBA content permissions remain unresolved. Source: https://www.nba.com/termsofuse . An open-source wrapper license is not a content license. Obtain rights-holder/legal advice; no disclaimer added here establishes authorization.
2. Replace the private contact placeholder in `client/src/siteContent.jsx`. Confirm the operator identity and relevant jurisdiction with qualified counsel before treating these notices as final legal documents.
3. Review existing analytics collections, provider retention settings and service-provider agreements. New consent behavior cannot retroactively remedy earlier collection. Verify Google Analytics enhanced-measurement/account settings do not collect sensitive URLs or form contents.
4. Choose a retention period and deletion process for completed draft records and infrastructure logs. The policy explicitly discloses that the app currently has no automatic draft-record deletion schedule. Confirm provider log retention against the deployed configuration.
5. Age wording alone does not establish compliance with children's privacy rules. Review intended audience and actual practices. No claim of certified compliance is made.

## Sources consulted

- FTC privacy guidance: https://www.ftc.gov/business-guidance/privacy-security/consumer-privacy
- FTC children's privacy FAQ: https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- Cloudflare Turnstile privacy: https://www.cloudflare.com/turnstile-privacy-policy/
- Google consent implementation: https://developers.google.com/tag-platform/security/guides/consent
- PostHog SDK configuration: https://posthog.com/docs/libraries/js/config

This is an implementation review, not a legal opinion or guarantee against claims. Live infrastructure, existing provider data and contractual permissions were not independently verified.
