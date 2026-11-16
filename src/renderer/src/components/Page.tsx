import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Heading } from '@astryxdesign/core/Text'

interface Props {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}

export function Page({ title, action, children }: Props): React.JSX.Element {
  return (
    <VStack gap={6}>
      <HStack gap={2} vAlign="center" hAlign="between">
        <Heading level={1}>{title}</Heading>
        {action}
      </HStack>
      {children}
    </VStack>
  )
}
