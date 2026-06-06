OAuth applications let third-party services sign users in to NAP and act
on their behalf via the OAuth 2.0 authorization-code flow.

## Anatomy

- **Client ID** — public identifier the third-party app sends in the
  authorize URL.
- **Client Secret** — confidential credential the third-party app uses
  to exchange the authorization code for tokens. Shown once at create
  / rotate time.
- **Redirect URIs** — exact URLs the platform is allowed to send users
  back to after consent. Must match the URI in the authorize request
  byte-for-byte.

## Create flow

1. Register the app here with name, redirect URIs, and (optionally) a
   homepage URL shown on the consent page.
2. Copy the Client ID and Client Secret immediately — the secret is
   not shown again.
3. Configure the third-party app with those credentials and point its
   OAuth client at this platform.

## Rotating secrets

Rotating issues a fresh secret and invalidates the previous one. Existing
refresh tokens stay valid; only authentication that requires the secret
(token exchange, client credential flows) is affected.
