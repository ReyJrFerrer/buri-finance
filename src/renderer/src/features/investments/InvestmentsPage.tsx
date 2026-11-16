import { useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import type { Holding, Investments, Security } from '../../../../shared/ipc'
import { formatQuantity } from '../../../../shared/money'
import { baseCurrency } from '../../../../shared/presets'
import { Amount } from '../../components/Amount'
import { DeleteButton } from '../../components/DeleteButton'
import { Page } from '../../components/Page'
import { Section } from '../../components/Section'
import { moneyWidth, nameWidth } from '../../lib/table'
import { useFxRefresh, useQuery } from '../../lib/useQuery'
import { BuyDialog, FxDialog, PriceDialog, SellDialog } from './InvestmentDialogs'

type Dialog = 'buy' | 'fx' | { sell: Holding } | { price: Security }
type FxRate = Investments['fxRates'][number]

const number = (text: string): React.JSX.Element => (
  <Text hasTabularNumbers textWrap="nowrap">
    {text}
  </Text>
)

export function InvestmentsPage(props: { onAddAccount: () => void }): React.JSX.Element {
  const [accounts] = useQuery(window.api.accounts.list)
  const [data, reloadData] = useQuery(window.api.investments.get)
  const fxError = useFxRefresh(reloadData)
  const [dialog, setDialog] = useState<Dialog>()
  const close = (): void => setDialog(undefined)
  const reload = (): void => {
    close()
    reloadData()
  }
  const addButton = (
    <Button label="Add holding" variant="primary" onClick={() => setDialog('buy')} />
  )
  const hasAssetAccount = accounts?.some((a) => a.type === 'asset')
  const currencies = [
    ...new Set(
      ['USD', ...(accounts ?? []).map((a) => a.currency)].filter((c) => c !== baseCurrency)
    )
  ]

  const holdingColumns: TableColumn<Holding>[] = [
    {
      key: 'symbol',
      header: 'Holding',
      width: nameWidth,
      renderCell: (h) => (
        <VStack gap={1}>
          <Text weight="medium">{h.symbol}</Text>
          <Text type="supporting">{h.accountName}</Text>
        </VStack>
      )
    },
    {
      key: 'quantityE8',
      header: 'Quantity',
      align: 'end',
      width: proportional(0.7, { minWidth: 90 }),
      renderCell: (h) => number(formatQuantity(h.quantityE8))
    },
    {
      key: 'price',
      header: 'Price',
      align: 'end',
      width: proportional(0.8, { minWidth: 110 }),
      renderCell: (h) => number(`${h.currency} ${h.price}`)
    },
    {
      key: 'costMinor',
      header: 'Cost',
      align: 'end',
      width: moneyWidth,
      renderCell: (h) => <Amount minor={h.costMinor} currency={h.currency} />
    },
    {
      key: 'valueMinor',
      header: 'Value',
      align: 'end',
      width: moneyWidth,
      renderCell: (h) => <Amount minor={h.valueMinor} currency={h.currency} />
    },
    {
      key: 'gainMinor',
      header: 'Gain',
      align: 'end',
      width: moneyWidth,
      renderCell: (h) => <Amount minor={h.gainMinor} currency={h.currency} />
    },
    {
      key: 'lotId',
      header: '',
      align: 'end',
      width: pixel(140),
      renderCell: (h) => (
        <HStack gap={1} hAlign="end" vAlign="center">
          <Button label={`Sell ${h.symbol}`} size="sm" onClick={() => setDialog({ sell: h })}>
            Sell
          </Button>
          <DeleteButton
            label={`Delete ${h.symbol} holding`}
            title={`Delete this ${h.symbol} lot?`}
            description="Use this for a lot entered by mistake. Any cash its purchase took is returned to the account. To record a sale, use Sell."
            onDelete={() => window.api.investments.removeLot(h.lotId).then(reload)}
          />
        </HStack>
      )
    }
  ]

  const priceColumns: TableColumn<Security>[] = [
    { key: 'symbol', header: 'Symbol' },
    { key: 'name', header: 'Name' },
    {
      key: 'price',
      header: 'Latest price',
      align: 'end',
      width: moneyWidth,
      renderCell: (s) => number(s.price ? `${s.currency} ${s.price}` : '')
    },
    {
      key: 'priceDate',
      header: 'As of',
      align: 'end',
      renderCell: (s) => number(s.priceDate ?? '')
    },
    {
      key: 'id',
      header: '',
      align: 'end',
      width: pixel(168),
      renderCell: (s) => (
        <Button
          label={`Update ${s.symbol} price`}
          size="sm"
          onClick={() => setDialog({ price: s })}
        >
          Update price
        </Button>
      )
    }
  ]

  const fxColumns: TableColumn<FxRate>[] = [
    { key: 'currency', header: 'Currency' },
    {
      key: 'rate',
      header: 'Rate',
      align: 'end',
      width: moneyWidth,
      renderCell: (r) => number(`1 ${r.currency} = ${baseCurrency} ${r.rate}`)
    },
    { key: 'date', header: 'As of', align: 'end', renderCell: (r) => number(r.date) }
  ]

  return (
    <Page title="Investments" action={data?.holdings.length ? addButton : undefined}>
      {data?.holdings.length === 0 && (
        <EmptyState
          title="No holdings yet"
          description={
            hasAssetAccount
              ? 'Add the shares you hold in DragonFi, GoTrade or any other broker account. Prices are entered by hand.'
              : 'Holdings live in a broker account, so start by adding one.'
          }
          headingLevel={2}
          actions={
            hasAssetAccount ? (
              addButton
            ) : (
              <Button label="Add account" variant="primary" onClick={props.onAddAccount} />
            )
          }
        />
      )}
      {!!data?.holdings.length && (
        <Table data={data.holdings} columns={holdingColumns} idKey="lotId" hasHover />
      )}
      {!!data?.securities.length && (
        <Section
          title="Prices"
          description="Holdings are valued at the latest price you have entered for each security."
        >
          <Table data={data.securities} columns={priceColumns} idKey="id" />
        </Section>
      )}
      {data && (
        <Section
          title="Exchange rates"
          description={`With a rate for each foreign currency, the overview also shows your net worth in ${baseCurrency}. Your original amounts are never changed. Rates update automatically from Frankfurter's daily reference rates; you can also set one by hand.`}
          action={<Button label="Set exchange rate" onClick={() => setDialog('fx')} />}
        >
          {fxError && (
            <Banner
              status="error"
              title="Exchange rates could not be updated"
              description={`${fxError} Showing the last saved rates.`}
            />
          )}
          {!!data.fxRates.length && (
            <Table data={data.fxRates} columns={fxColumns} idKey="currency" />
          )}
        </Section>
      )}
      {dialog === 'buy' && accounts && (
        <BuyDialog accounts={accounts} onClose={close} onSaved={reload} />
      )}
      {dialog === 'fx' && <FxDialog currencies={currencies} onClose={close} onSaved={reload} />}
      {typeof dialog === 'object' && 'sell' in dialog && (
        <SellDialog holding={dialog.sell} onClose={close} onSaved={reload} />
      )}
      {typeof dialog === 'object' && 'price' in dialog && (
        <PriceDialog security={dialog.price} onClose={close} onSaved={reload} />
      )}
    </Page>
  )
}
