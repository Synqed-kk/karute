// Stand-in for @/i18n/navigation: a plain <a>; ?path= is the pathname.
import type { MouseEvent, ReactNode } from 'react'

const q = new URLSearchParams(location.search)
export const usePathname = () => q.get('path') ?? '/dashboard'
export const useRouter = () => ({ push: () => {}, back: () => {} })
export function Link({
  href,
  children,
  onClick,
  ...rest
}: { href: string; children: ReactNode; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void } & Record<
  string,
  unknown
>) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e)
        e.preventDefault()
      }}
      {...rest}
    >
      {children}
    </a>
  )
}
