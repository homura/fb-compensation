## Workflows

`generate-burn-record.yml`: Generate burn records from the last saved block to the tip block(-24 blocks to ensure the block is confirmed). Scheduled to run every 24 hours at 16:10 UTC. Or manually triggered by “Actions > Workflows > Generate Burn Record”.

`fill-transfer-hashes.yml`: Fill transfer hashes from the aggregated burn records back to the daily burn records. Manually triggered by “Actions > Workflows > Fill Transfer Hashes” with the `aggrWeekDir` input parameter. The `aggrWeekDir` should be in the format of `{yyyymmdd}-{yyyymmdd}`
