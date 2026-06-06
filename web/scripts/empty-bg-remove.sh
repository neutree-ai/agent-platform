#!/usr/bin/env bash
# Local post-processing for empty-state assets.
#
# Cloud agent generates RGB images with a solid (near-white) background.
# This script extracts alpha and produces a small transparent WebP.
#
# Two modes — pick by image type:
#
#   --line   chroma-key on white. Right for hairline line drawings (Style A
#            editorial silhouette). Crisp ink edges, no halos.
#
#   --solid  rembg + BiRefNet-General silhouette segmentation. Right for
#            soft-edge renders (Style B clay 3D). Chroma-key would leave
#            fringe artifacts on gradient edges. BiRefNet-General is 2024
#            SOTA-tier, same quality class as RMBG-2.0 but no HF gating.
#            Model (~885MB) auto-downloads to ~/.u2net/ on first run.
#
# Output: <basename>.webp at quality 90 (visually identical to lossless,
# ~5-15KB typical). Lands next to the input.
#
# Deps: ImageMagick (`magick`), rembg (`rembg`), cwebp.

set -euo pipefail

mode=""
input=""

while [ $# -gt 0 ]; do
  case "$1" in
    --line) mode="line"; shift ;;
    --solid) mode="solid"; shift ;;
    -*) echo "unknown flag: $1" >&2; exit 1 ;;
    *) input="$1"; shift ;;
  esac
done

if [ -z "$mode" ] || [ -z "$input" ]; then
  echo "usage: $0 (--line|--solid) <input.{png,webp,jpg}>" >&2
  exit 1
fi

if [ ! -f "$input" ]; then
  echo "input not found: $input" >&2
  exit 1
fi

base="${input%.*}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

case "$mode" in
  line)
    # Pixels close to white -> alpha 0. Fuzz 8% tolerates compression near-whites
    # like 254,254,254 from imagegen WebP output.
    magick "$input" -fuzz 8% -transparent white -alpha set "$tmp/rgba.png"
    ;;
  solid)
    # First run downloads BiRefNet-General (~885MB) into ~/.u2net/. Warm afterwards.
    rembg i -m birefnet-general "$input" "$tmp/rgba.png"
    ;;
esac

cwebp -quiet -q 90 -alpha_q 100 "$tmp/rgba.png" -o "$base.webp"
size=$(wc -c < "$base.webp")
echo "$base.webp  ${size} bytes"
