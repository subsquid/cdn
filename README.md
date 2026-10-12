# CDN-served content

Everything saved into `src/<PATH>` in this repo becomes available under
`https://cdn.subsquid.io/<PATH>`.

Bucket CORS (`cors.json`) is not applied by CI, whose service account can't
change bucket settings. A bucket admin applies it once:

    gcloud storage buckets update gs://subsquid-public --cors-file=cors.json
