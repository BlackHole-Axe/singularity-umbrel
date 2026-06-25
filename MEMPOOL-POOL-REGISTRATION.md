# Get "SINGULARITY" recognized as a pool on mempool.space (official way)

When this pool finds a block, the coinbase carries the tag **`SINGULARITY on Umbrel`**
(set via `COINBASE_TAG` in `singularity-pool/docker-compose.yml`). Any explorer
already shows that text in the block's **coinbase / scriptSig** details.

To make mempool.space (and forks) label the block's **miner as "SINGULARITY"**
instead of "Unknown", you register the tag in mempool's public pool database.

## Steps

1. Fork **https://github.com/mempool/mining-pools**
2. Edit **`pools-v2.json`** and add a new pool object (mempool assigns the next
   `id`; copy the shape of existing entries). Use the entry in
   [`mempool-pool-entry.json`](mempool-pool-entry.json):

   ```json
   {
     "name": "SINGULARITY",
     "link": "https://github.com/BlackHole-Axe/singularity-umbrel",
     "addresses": [],
     "tags": [
       "SINGULARITY on Umbrel",
       "/SINGULARITY/",
       "SINGULARITY"
     ]
   }
   ```

   - `tags` are matched against the coinbase scriptSig text. `"SINGULARITY on Umbrel"`
     matches the exact tag; `"SINGULARITY"` also catches it if you change the suffix later.
   - `addresses` can stay empty (solo pool pays a different wallet each block, so
     address-matching doesn't apply). Tag-matching is enough.
3. Open a PR to `mempool/mining-pools`. Once merged, mempool.space and every site
   that uses this database will show blocks you find as the **SINGULARITY** pool,
   and the block details show **`SINGULARITY on Umbrel`** in the coinbase.

> Note: it only takes effect for blocks mined **after** your coinbase tag is live
> and the PR is merged. Past blocks aren't re-tagged retroactively by most sites.

## Want a logo next to the name on mempool?

mempool pulls pool logos from its own assets repo. After the pool entry is merged,
you can submit your `assets/icon.svg` to mempool's logo set (they'll point you to
the right place in the PR review).
