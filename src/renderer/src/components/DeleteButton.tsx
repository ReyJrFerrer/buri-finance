import { useState } from 'react'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TrashIcon } from '@heroicons/react/24/outline'
import { errorMessage } from '../lib/useQuery'

interface Props {
  label: string
  title: string
  description: string
  details?: React.ReactNode // shown under the description, for things deleted along with it
  onDelete: () => Promise<unknown>
  onError?: (message: string) => void // the delete was refused; the dialog closes either way
}

// A trash button that asks before it deletes.
export function DeleteButton(props: Props): React.JSX.Element {
  const { label, title, description, details, onDelete, onError } = props
  const [isOpen, setOpen] = useState(false)
  const confirm = async (): Promise<void> => {
    try {
      await onDelete()
    } catch (e) {
      onError?.(errorMessage(e))
    }
    setOpen(false)
  }
  return (
    <>
      <IconButton
        label={label}
        icon={<Icon icon={TrashIcon} />}
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      />
      {details ? (
        // AlertDialog takes plain text only, so richer details get the same layout in a Dialog.
        <Dialog isOpen={isOpen} onOpenChange={setOpen} width={440}>
          <Layout
            header={<DialogHeader title={title} onOpenChange={setOpen} />}
            content={
              <LayoutContent>
                <VStack gap={3}>
                  <Text type="supporting">{description}</Text>
                  {details}
                </VStack>
              </LayoutContent>
            }
            footer={
              <LayoutFooter>
                <HStack gap={2} hAlign="end">
                  <Button label="Cancel" variant="secondary" onClick={() => setOpen(false)} />
                  <Button label="Delete" variant="destructive" clickAction={confirm} />
                </HStack>
              </LayoutFooter>
            }
          />
        </Dialog>
      ) : (
        <AlertDialog
          isOpen={isOpen}
          onOpenChange={setOpen}
          title={title}
          description={description}
          actionLabel="Delete"
          actionVariant="destructive"
          onAction={confirm}
        />
      )}
    </>
  )
}
