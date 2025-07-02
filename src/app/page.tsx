import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function Home() {
  return (
    <div>
      <Button>Connect MetaMask</Button>

      <Tabs defaultValue="balance" className="w-[400px]">
        <TabsList>
          <TabsTrigger value="balance">Balance</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="balance">ETH: 0</TabsContent>
        <TabsContent value="history">None</TabsContent>
      </Tabs>
    </div>
  )
}
