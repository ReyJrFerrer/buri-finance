import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'

interface Props {
  title: string
  submitLabel: string
  error?: string
  onSubmit: () => Promise<void>
  onClose: () => void
  children: React.ReactNode
}

// A modal form: fields in the body, Cancel and a primary submit in the footer.
export function FormDialog(props: Props): React.JSX.Element {
  const { title, submitLabel, error, onSubmit, onClose, children } = props
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} purpose="form" width={480}>
      <Layout
        header={<DialogHeader title={title} onOpenChange={onClose} />}
        content={
          <LayoutContent>
            <VStack gap={4}>
              {error && <Banner status="error" title={error} />}
              {children}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="secondary" onClick={onClose} />
              <Button label={submitLabel} variant="primary" clickAction={onSubmit} />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  )
}
