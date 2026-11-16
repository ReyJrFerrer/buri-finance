import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { VStack } from '@astryxdesign/core/Stack'
import { Heading, Text } from '@astryxdesign/core/Text'
import { formatMinor } from '../../../../shared/money'
import { Page } from '../../components/Page'
import { useQuery } from '../../lib/useQuery'
import { AccountsTable } from '../accounts/AccountsTable'

export function OverviewPage(props: { onAddAccount: () => void }): React.JSX.Element {
  const [accounts] = useQuery(window.api.accounts.list)
  const [netWorth] = useQuery(window.api.netWorth.get)

  if (accounts?.length === 0) {
    return (
      <Page title="Overview">
        <EmptyState
          title="Your net worth starts here"
          description="Add an account with its current balance to see what you have and what you owe."
          headingLevel={2}
          actions={<Button label="Add account" variant="primary" onClick={props.onAddAccount} />}
        />
      </Page>
    )
  }

  return (
    <Page title="Overview">
      <Grid columns={{ minWidth: 280, repeat: 'fit' }} gap={4}>
        {netWorth?.map((total) => (
          <Card key={total.currency}>
            <VStack gap={2}>
              <Text type="supporting">Net worth · {total.currency}</Text>
              <Text type="display-3" weight="bold" hasTabularNumbers>
                {formatMinor(total.netMinor, total.currency)}
              </Text>
              <Text type="supporting" hasTabularNumbers>
                Assets {formatMinor(total.assetsMinor, total.currency)} · Liabilities{' '}
                {formatMinor(total.liabilitiesMinor, total.currency)}
              </Text>
            </VStack>
          </Card>
        ))}
      </Grid>
      {(netWorth?.length ?? 0) > 1 && (
        <Text type="supporting">
          Each currency is totalled separately. Amounts are not converted until an exchange rate is
          recorded.
        </Text>
      )}
      {accounts && (
        <VStack gap={3}>
          <Heading level={2}>Accounts</Heading>
          <AccountsTable accounts={accounts} />
        </VStack>
      )}
    </Page>
  )
}
