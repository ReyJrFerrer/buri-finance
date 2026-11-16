import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Heading, Text } from '@astryxdesign/core/Text'

interface Props {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}

// A titled block inside a page, with an optional action beside the title.
export function Section({ title, description, action, children }: Props): React.JSX.Element {
  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center" hAlign="between">
        <Heading level={2}>{title}</Heading>
        {action}
      </HStack>
      {description && <Text type="supporting">{description}</Text>}
      {children}
    </VStack>
  )
}
