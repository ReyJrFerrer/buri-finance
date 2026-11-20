import { useState } from 'react'
import { TextInput } from '@astryxdesign/core/TextInput'
import type { Account } from '../../../../shared/ipc'
import { FormDialog } from '../../components/FormDialog'
import { errorMessage } from '../../lib/useQuery'

export function EditAccountDialog(props: {
  account: Account
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { account } = props
  const [name, setName] = useState(account.name)
  const [institution, setInstitution] = useState(account.institution ?? '')
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)
  const isNameMissing = name.trim() === ''

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (isNameMissing) return
    try {
      await window.api.accounts.update({
        id: account.id,
        name,
        institution: institution.trim() === '' ? null : institution
      })
      props.onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title="Edit account"
      submitLabel="Save changes"
      error={error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      <TextInput
        label="Account name"
        value={name}
        onChange={setName}
        isRequired
        status={
          hasSubmitted && isNameMissing ? { type: 'error', message: 'Enter a name' } : undefined
        }
      />
      <TextInput label="Institution" value={institution} onChange={setInstitution} isOptional />
    </FormDialog>
  )
}
