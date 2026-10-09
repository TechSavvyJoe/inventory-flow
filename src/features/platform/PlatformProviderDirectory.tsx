import { FlowLedgerHeading, flowButtonClassName } from '../../design-system'
import { useMemo, useState } from 'react'
import { Search, Library } from 'lucide-react'
import { PROVIDERS } from './platformPresentation'
import { SOURCE_CATALOG, sourceProfiles, type SourceProfile } from './sourceCatalog'
import './PlatformProviderDirectory.css'

const CATEGORIES = [...new Set(SOURCE_CATALOG.map(profile => profile.category))]

export function PlatformProviderDirectory({ busy, onChoose }: { busy: boolean; onChoose: (profile: SourceProfile) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const profiles = useMemo(() => sourceProfiles(query, category === 'all' ? undefined : category), [category, query])

  return <section className="platform-provider-directory" aria-label="Provider directory">
    <FlowLedgerHeading level={3} title={<><Library size={20} aria-hidden="true" />Provider directory</>} description="Research notes for dealership software and data sources." />
    <p className="platform-provider-boundary">These are planning references, not live integrations. Saving a source configuration does not install an adapter or provide access.</p>

    <div className="platform-provider-toolbar">
      <label className="platform-provider-search">
        <Search aria-hidden="true" />
        <span className="platform-provider-visually-hidden">Find providers</span>
        <input aria-label="Find providers" placeholder="Provider, evidence, or access method" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <label className="platform-provider-category">
        <span>Category</span>
        <select aria-label="Provider category" value={category} onChange={event => setCategory(event.target.value)}>
          <option value="all">All categories</option>
          {CATEGORIES.map(value => <option key={value} value={value}>{PROVIDERS[value] ?? value}</option>)}
        </select>
      </label>
    </div>

    <p className="platform-provider-count" role="status">{profiles.length} of {SOURCE_CATALOG.length} providers</p>
    <div className="platform-provider-list">
      {profiles.map(profile => <article className="platform-provider-row" key={profile.id} aria-label={profile.name}>
        <div className="platform-provider-identity">
          <strong>{profile.name}</strong>
          <span>{profile.segment}</span>
        </div>
        <div className="platform-provider-evidence">
          <p>{profile.evidence[0]}</p>
          <details>
            <summary>Access and setup requirements</summary>
            <dl>
              <div><dt>Documented access</dt><dd>{profile.access}</dd></div>
              <div><dt>Approval and limits</dt><dd>{profile.gate}</dd></div>
            </dl>
          </details>
        </div>
        <a className="platform-provider-source" href={profile.url} target="_blank" rel="noreferrer">Official source<span className="platform-provider-visually-hidden"> for {profile.name} (opens in a new tab)</span></a>
        <button type="button" className={flowButtonClassName({ variant: "secondary", className: "platform-provider-configure" })} disabled={busy} onClick={() => onChoose(profile)}>Configure {profile.name}</button>
      </article>)}
      {!profiles.length && <p className="platform-provider-empty">No providers match. Change the search or category filter.</p>}
    </div>
  </section>
}
