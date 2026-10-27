# Umbra UI review — 26 October 2026

Scope: the consumer interface, navigation, responsive layouts, recovery states, branding,
and contract-documentation placement. This is a UI review, not a certification of protocol
security or financial readiness.

## Addressed

- Contract registry and operator console removed from the app router, including `?admin`
  and `?admin=full`. Contract addresses and operator instructions are in the README.
- Requested testnet disclaimer banner removed.
- Consistent Umbra monogram across the header, footer and favicon.
- Five primary navigation destinations with separate privacy tools and mobile navigation.
- Clipboard success and failure feedback, with no copied secrets in notifications.
- Public balance requests clear the previous account's balance and offer retry on failure.
- Swap quotes ignore responses from superseded inputs. Controls are locked while a swap
  is processing, keeping the visible form aligned with the submitted transaction.
- Payment and receive selectors use button-group semantics rather than incomplete ARIA tabs.
- Screen errors show a recovery page instead of leaving the interface blank.

## Verification

- Frontend TypeScript check and production build pass.
- Browser navigation checked at widths 320, 390, 768 and 1440 pixels: no horizontal page
  overflow on the home page or disconnected Wallet, Pay, Swap and Privacy screens.
- No browser JavaScript exceptions during these checks.
- Verified the removed banner and operator console are absent, including at `?admin=full`.
- Inspected desktop and mobile screenshots in light and dark themes.
- Connected EVM layouts were checked using a read-only wallet stub: no horizontal
  overflow or unlabelled inputs on Wallet, Pay, Swap and Privacy at 390 and 1440 pixels.
  The stub cannot sign or submit transactions.

## Remaining limits

- The initial JavaScript bundle remains large (about 1.06 MB gzipped); proof code and feature
  screens load separately. Further SDK loading work would improve first-load performance.
- UI verification does not establish current DEX liquidity or guarantee transaction execution.
- A real wallet signing session and transactions on Portaldot were not exercised in this review.
