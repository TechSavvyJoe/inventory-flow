import type { AnchorHTMLAttributes } from 'react'
import { Link, useInRouterContext, useLocation } from 'react-router-dom'
import { currentWorkspaceReturnPath, withWorkspaceReturnPath } from '../lib/inventory-navigation'

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string
  preserveOrigin?: boolean
}

function RoutedWorkspaceLink({ to, preserveOrigin, ...props }: Props) {
  const location = useLocation()
  const destination = preserveOrigin ? withWorkspaceReturnPath(to, currentWorkspaceReturnPath(location)) : to
  return <Link {...props} to={destination} />
}

/** Internal workflow links retain in-memory searches, selections and drafts. */
export function WorkspaceLink(props: Props) {
  const routed = useInRouterContext()
  if (routed) return <RoutedWorkspaceLink {...props} />
  const { to, preserveOrigin: _preserveOrigin, ...anchor } = props
  return <a {...anchor} href={to} />
}
