// Build identity baked into this bundle by vite at `npm run build` time.
// See oss/control-plane/Dockerfile + scripts/rollout.sh for how these are
// populated. Empty / "dev" means a local dev build with no stamping.

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev'
