import { useState } from 'react'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { TrashIcon } from '@heroicons/react/24/outline'

interface Props {
  label: string
  title: string
  description: string
  onDelete: () => Promise<unknown>
}

// A trash button that asks before it deletes.
export function DeleteButton({ label, title, description, onDelete }: Props): React.JSX.Element {
  const [isOpen, setOpen] = useState(false)
  return (
    <>
      <IconButton
        label={label}
        icon={<Icon icon={TrashIcon} />}
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      />
      <AlertDialog
        isOpen={isOpen}
        onOpenChange={setOpen}
        title={title}
        description={description}
        actionLabel="Delete"
        actionVariant="destructive"
        onAction={async () => {
          await onDelete()
          setOpen(false)
        }}
      />
    </>
  )
}
