import { useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'
import { searchFieldsMatch } from '../lib/search'
import './PredictiveSearchInput.css'

export interface PredictiveSearchCandidate {
  id: string
  label: string
  detail?: string
  value?: string
  searchValues: readonly unknown[]
}

export function PredictiveSearchInput({
  className,
  value,
  onChange,
  candidates,
  ariaLabel,
  placeholder,
  clearLabel,
  inputType = 'text',
  autoFocus,
}: {
  className: string
  value: string
  onChange: (value: string) => void
  candidates: readonly PredictiveSearchCandidate[]
  ariaLabel: string
  placeholder: string
  clearLabel: string
  inputType?: 'text' | 'search'
  autoFocus?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const listboxId = useId()
  const hintId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const suggestions = useMemo(() => value.trim()
    ? candidates.filter(candidate => searchFieldsMatch(value, candidate.searchValues)).slice(0, 6)
    : [], [candidates, value])
  const expanded = open && suggestions.length > 0
  const hasQuery = value.trim().length > 0

  const select = (candidate: PredictiveSearchCandidate) => {
    onChange(candidate.value ?? candidate.label)
    setOpen(false)
    setActiveIndex(-1)
    inputRef.current?.focus()
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (expanded) event.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!suggestions.length) return
      event.preventDefault()
      setOpen(true)
      setActiveIndex(current => event.key === 'ArrowDown'
        ? current >= suggestions.length - 1 ? 0 : current + 1
        : current <= 0 ? suggestions.length - 1 : current - 1)
      return
    }
    if (event.key === 'Enter') {
      if (activeIndex >= 0) {
        const candidate = suggestions[activeIndex]
        if (candidate) { event.preventDefault(); select(candidate) }
      } else if (hasQuery && expanded) {
        // Match InventoryPredictiveSearch: keep the typed query and close the list.
        setOpen(false)
        setActiveIndex(-1)
      }
    }
  }
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  return <div ref={rootRef} className={`${className} predictive-search-input`} onBlur={handleBlur}>
    <Search aria-hidden="true" />
    <label className="sr-only" htmlFor={inputId}>{ariaLabel}</label>
    <input
      ref={inputRef}
      id={inputId}
      autoFocus={autoFocus}
      type={inputType}
      role="combobox"
      value={value}
      onChange={event => { onChange(event.target.value); setOpen(true); setActiveIndex(-1) }}
      onFocus={() => setOpen(true)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-autocomplete="list"
      aria-expanded={expanded}
      aria-controls={listboxId}
      aria-activedescendant={expanded && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
      aria-describedby={hintId}
      autoComplete="off"
      spellCheck={false}
    />
    {value ? <button type="button" onClick={() => { onChange(''); setOpen(false); setActiveIndex(-1); inputRef.current?.focus() }} aria-label={clearLabel}><X aria-hidden="true" /></button> : null}
    <span className="sr-only" id={hintId}>
      Use the arrow keys to review suggestions, Enter to choose or keep the typed query, and Escape to close.
    </span>
    {expanded ? <ul id={listboxId} className="predictive-search-input__list" role="listbox" aria-label={`${ariaLabel} suggestions`}>
      {suggestions.map((candidate, index) => <li
        id={`${listboxId}-${index}`}
        key={candidate.id}
        role="option"
        aria-selected={index === activeIndex}
        onMouseDown={event => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => select(candidate)}
      ><strong><span className="sr-only">Suggestion: </span>{candidate.label}</strong>{candidate.detail ? <span>{candidate.detail}</span> : null}</li>)}
    </ul> : null}
  </div>
}
