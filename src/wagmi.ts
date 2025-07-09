import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import {
  arbitrum,
  base,
  mainnet,
  optimism,
  polygon,
  sepolia,
} from 'wagmi/chains'

import { isMainnet } from './env'

export const config = getDefaultConfig({
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'fb-compensation',
  projectId: process.env.NEXT_PUBLIC_PROJECT_ID ?? 'YOUR_PROJECT_ID',
  chains: isMainnet ? [mainnet, polygon, optimism, arbitrum, base] : [sepolia],
  ssr: true,
})
