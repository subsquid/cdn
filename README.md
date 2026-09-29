# CDN-served content

Everything saved into `src/<PATH>` in this repo becomes available under
`https://cdn.subsquid.io/<PATH>`.

## Network logos

Logos in `src/img/networks/` are shown at 20 to 48 px next to the chain name,
in the docs and on sqd.dev. When adding one:

- Use SVG, or PNG no larger than 256 × 256 px. JPEG suits only images with no
  transparency.
- Keep the format and the extension in agreement: a `.png` file holds PNG data.
- An SVG that embeds a raster image keeps it at 256 px or less.
- Use the chain's icon, not its wordmark, since the name is shown beside it.
