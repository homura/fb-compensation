export const isMainnet = process.env.NEXT_PUBLIC_IS_MAINNET === 'true'
export const burnStartBlockNumber = Number(
  process.env.NEXT_PUBLIC_BURN_START_BLOCK_NUMBER ?? 10_000_000,
)
