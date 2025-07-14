'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { toast } from 'sonner'
import { useAccount, useDisconnect } from 'wagmi'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { generateCKBAddress } from '@/sdk/forcebridge'

import BurnTokens from './burn-tokens'
import History from './history'

const Copy = (props: React.ComponentProps<'svg'>) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M10 1.33333H6.00004C5.63185 1.33333 5.33337 1.63181 5.33337 1.99999V3.33333C5.33337 3.70152 5.63185 3.99999 6.00004 3.99999H10C10.3682 3.99999 10.6667 3.70152 10.6667 3.33333V1.99999C10.6667 1.63181 10.3682 1.33333 10 1.33333Z"
      stroke="black"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.33329 2.66667H3.99996C3.64634 2.66667 3.3072 2.80715 3.05715 3.0572C2.8071 3.30724 2.66663 3.64638 2.66663 4.00001V13.3333C2.66663 13.687 2.8071 14.0261 3.05715 14.2761C3.3072 14.5262 3.64634 14.6667 3.99996 14.6667H12C12.3536 14.6667 12.6927 14.5262 12.9428 14.2761C13.1928 14.0261 13.3333 13.687 13.3333 13.3333V12"
      stroke="black"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10.6666 2.66667H12C12.3536 2.66667 12.6927 2.80715 12.9428 3.0572C13.1928 3.30724 13.3333 3.64638 13.3333 4.00001V6.66667"
      stroke="black"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14 9.33333H7.33337"
      stroke="black"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10 6.66667L7.33337 9.33334L10 12"
      stroke="black"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export default function Home() {
  const { address } = useAccount()
  const { disconnect } = useDisconnect()
  const ckbAddress = address ? generateCKBAddress(address) : ''
  const onCopy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('Copied', { position: 'top-center' }))

  return (
    <div className="w-full">
      <div className="grid grid-cols-3 p-4">
        <p className="font-bold">ForceBridge Compensation</p>
        <Button className="block text-left" variant="link">
          Documentation
        </Button>
      </div>
      {address ? (
        <div className="m-auto w-full px-10 md:w-[600px]">
          <div className="my-4">
            <div className="mb-2">
              <p className="mb-2 text-[#676767]">CKB Address:</p>
              <p>
                <span className="inline break-all">{ckbAddress}</span>
                <Copy
                  onClick={() => onCopy(ckbAddress)}
                  className="ml-2 inline-block align-middle"
                />
              </p>
            </div>
            <div>
              <p className="mb-2 text-[#676767]">ETH Address:</p>
              <p>
                <span className="inline break-all">{address}</span>
                <Copy
                  onClick={() => onCopy(address)}
                  className="ml-2 inline-block align-middle"
                />
              </p>
            </div>
          </div>
          <div className="text-center">
            <Button onClick={() => disconnect()}>Disconnect</Button>
          </div>
          <Tabs defaultValue="balance" className="my-2 w-full">
            <TabsList className="my-2">
              <TabsTrigger value="balance">Balance</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="balance" className="my-2">
              <BurnTokens />
            </TabsContent>
            <TabsContent value="history">
              <History />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="m-auto w-full pt-20 md:w-[460px]">
          <div className="[&>div]:flex [&>div]:justify-center">
            <ConnectButton accountStatus="address" />
          </div>
          <div className="mt-20">
            <p>Please note that </p>
            <ul className="list-inside list-disc">
              <li>
                Connect to an address <strong>UNDER YOUR CONTROL</strong>
              </li>
              <li>Use this tool to burn your ForceBridge related tokens</li>
              <li>
                The burnt tokens will be sent to the same connected Ethereum
                address
              </li>
              <li>
                Only tokens burn with the Force Bridge lock can be recognized
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
