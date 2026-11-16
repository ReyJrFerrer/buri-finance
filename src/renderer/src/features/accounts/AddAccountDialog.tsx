import { useState } from 'react'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Selector } from '@astryxdesign/core/Selector'
import { DateInput } from '@astryxdesign/core/DateInput'
import { userAccountTypeSchema } from '../../../../shared/ipc'
import { parseAmountToMinor } from '../../../../shared/money'
import { baseCurrency, institutionPresets } from '../../../../shared/presets'
import { FormDialog } from '../../components/FormDialog'
import { errorMessage, today } from '../../lib/useQuery'

const other = 'Other'
const presetOptions = [
  ...institutionPresets.map((p) => ({
    value: p.institution,
    label: p.institution,
    description: `${p.kind} · ${p.currency}`
  })),
  { value: other, label: other, description: 'Any other bank, wallet, card or loan' }
]
const typeOptions = [
  { value: 'asset', label: 'Asset', description: 'Money you have: bank, wallet, broker' },
  { value: 'liability', label: 'Liability', description: 'Money you owe: credit card, loan' }
]

export function AddAccountDialog(props: {
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [institution, setInstitution] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState('asset')
  const [currency, setCurrency] = useState<string>(baseCurrency)
  const [opening, setOpening] = useState('')
  const [openingDate, setOpeningDate] = useState(today())
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)

  const openingMinor = opening.trim() === '' ? 0 : parseAmountToMinor(opening)
  const isNameMissing = name.trim() === ''

  const choosePreset = (value: string): void => {
    const preset = institutionPresets.find((p) => p.institution === value)
    // Fill the name only while the user has not typed their own.
    if (isNameMissing || name === institution) setName(preset?.institution ?? '')
    if (preset) setCurrency(preset.currency)
    setInstitution(value)
  }

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (isNameMissing || openingMinor === null) return
    try {
      await window.api.accounts.create({
        name,
        type: userAccountTypeSchema.parse(type),
        institution: institution === '' || institution === other ? null : institution,
        currency,
        parentId: null,
        openingBalanceMinor: openingMinor,
        openingDate
      })
      props.onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title="Add account"
      submitLabel="Save account"
      error={error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      <Selector
        label="Institution"
        placeholder="Choose a preset"
        options={presetOptions}
        value={institution}
        onChange={choosePreset}
      />
      <TextInput
        label="Account name"
        value={name}
        onChange={setName}
        isRequired
        status={
          hasSubmitted && isNameMissing ? { type: 'error', message: 'Enter a name' } : undefined
        }
      />
      <Selector label="Type" options={typeOptions} value={type} onChange={setType} />
      <Selector label="Currency" options={['PHP', 'USD']} value={currency} onChange={setCurrency} />
      <TextInput
        label={type === 'liability' ? `Amount owed (${currency})` : `Current balance (${currency})`}
        value={opening}
        onChange={setOpening}
        inputMode="decimal"
        placeholder="0.00"
        isOptional
        status={
          openingMinor === null
            ? { type: 'error', message: 'Enter an amount like 1,234.50' }
            : undefined
        }
      />
      <DateInput
        label="Balance as of"
        value={openingDate}
        onChange={(value) => value && setOpeningDate(value)}
      />
    </FormDialog>
  )
}
