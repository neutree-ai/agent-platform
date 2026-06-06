Quickly create an SSH private key Credential. After you select the key type, the standard file name and path are filled in automatically and written into the container with `0600` permissions.

## Supported key types

| Type | File name | Path |
|------|--------|------|
| ED25519 | `id_ed25519` | `~/.ssh/id_ed25519` |
| RSA | `id_rsa` | `~/.ssh/id_rsa` |
| ECDSA | `id_ecdsa` | `~/.ssh/id_ecdsa` |
| Custom | Custom | Custom |

## Usage

Paste the private key content into the **Value** field. It is usually obtained locally from `cat ~/.ssh/id_ed25519`.

## Notes

- Paste **only the private key**; the public key must be configured on the Git platform side
- The platform automatically appends a trailing newline
- To configure multiple keys at the same time, create multiple Credentials
