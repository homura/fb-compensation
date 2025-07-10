import dayjs from 'dayjs'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import React from 'react'
import { useAccount } from 'wagmi'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { isMainnet } from '@/env'
import { amountUnitToAmountScaled, trunkTxHash } from '@/lib/utils'
import {
  createForceBridgeHelper,
  generateCKBAddress,
  TokenInfo,
} from '@/sdk/forcebridge'

import NoData from './no-data'

const EXPLORER_URL = isMainnet
  ? 'https://explorer.nervos.org'
  : 'https://testnet.explorer.nervos.org'

const ETH_URL = isMainnet
  ? 'https://etherscan.io'
  : 'https://sepolia.etherscan.io'

const BSC_URL = isMainnet
  ? 'https://bscscan.com'
  : 'https://testnet.bscscan.com'

function generateTxUrl(txHash: string, chain: 'ckb' | 'Ethereum' | 'BSC') {
  switch (chain) {
    case 'ckb':
      return `${EXPLORER_URL}/transaction/${txHash}`
    case 'Ethereum':
      return `${ETH_URL}/tx/${txHash}`
    case 'BSC':
      return `${BSC_URL}/tx/${txHash}`
  }
}

export default function History() {
  const { address: ethAddress } = useAccount()
  const ckbAddress = ethAddress ? generateCKBAddress(ethAddress) : ''
  const [burnTxs, setBurnTxs] = useState<
    {
      txHash: string
      timestamp: number
      tokens: (TokenInfo & { tokenAmountUnit: bigint })[]
    }[]
  >([])
  useEffect(() => {
    if (!ckbAddress) return
    const forcebridgeHelper = createForceBridgeHelper()
    forcebridgeHelper.fetchBurnTxs(ckbAddress).then(setBurnTxs)
  }, [ckbAddress])
  const burnDates = useMemo(
    () => burnTxs.map((v) => dayjs(v.timestamp).format('YYYY-MM-DD')).join(','),
    [burnTxs],
  )
  const [compensationTxs, setCompensationTxs] = useState<
    Record<string, Record<string, string>>
  >({})
  useEffect(() => {
    if (!burnDates) return
    fetch('/api?dates=' + burnDates)
      .then((res) => res.json())
      .then(setCompensationTxs)
  }, [burnDates])

  return (
    <div>
      {burnTxs.length === 0 && (
        <div className="flex flex-col items-center justify-center p-2">
          <NoData /> No Burn History
        </div>
      )}
      {burnTxs.map((v, idx) => (
        <React.Fragment key={v.txHash}>
          <div className="p-2">
            <p>{dayjs(v.timestamp).format('YYYY-MM-DD')}</p>
            <p>
              Burn on CKB:{' '}
              <Button variant="link">
                <Link href={generateTxUrl(v.txHash, 'ckb')} target="_blank">
                  {trunkTxHash(v.txHash)}
                </Link>
              </Button>
            </p>
            <Accordion type="single" collapsible>
              <AccordionItem value="item-1">
                <AccordionTrigger>
                  <p>
                    Received:{' '}
                    {Object.keys(compensationTxs[v.txHash] ?? {}).length}/
                    {v.tokens.length}
                  </p>
                </AccordionTrigger>
                <AccordionContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Token</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Receive Tx</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {v.tokens.map((item) => (
                        <TableRow key={item.sudtArgs}>
                          <TableCell>{item.symbol}</TableCell>
                          <TableCell>
                            {amountUnitToAmountScaled(
                              item.tokenAmountUnit,
                              item.decimal,
                            )}
                          </TableCell>
                          <TableCell>
                            {compensationTxs[v.txHash]?.[item.sudtArgs] ? (
                              <Button variant="link">
                                <Link
                                  href={generateTxUrl(
                                    compensationTxs[v.txHash]?.[item.sudtArgs],
                                    item.source,
                                  )}
                                  target="_blank"
                                >
                                  {trunkTxHash(
                                    compensationTxs[v.txHash]?.[item.sudtArgs],
                                  )}
                                </Link>
                              </Button>
                            ) : (
                              'Pending'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
          {idx !== burnTxs.length - 1 && <Separator />}
        </React.Fragment>
      ))}
    </div>
  )
}
