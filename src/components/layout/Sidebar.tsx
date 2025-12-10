'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  name: string
  href: string
  icon: string
  roles?: string[]
}

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: '🏠' },
  { name: 'Products', href: '/products', icon: '📦' },
  { name: 'Media Library', href: '/media', icon: '🖼️' },
  { name: 'Import', href: '/dashboard/import', icon: '⬇️' },
  { name: 'Sync Status', href: '/sync', icon: '🔄' },
  { name: 'Admin', href: '/admin', icon: '⚙️', roles: ['admin'] },
]

export function Sidebar({ userRole }: { userRole: string }) {
  const pathname = usePathname()

  const filteredNav = navigation.filter(
    item => !item.roles || item.roles.includes(userRole)
  )

  return (
    <aside className="w-64 bg-slate-800/50 border-r border-slate-700/50 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-slate-700/50">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-lg">
            K
          </div>
          <div>
            <h1 className="font-bold text-white">Kinkstore</h1>
            <p className="text-xs text-slate-400">PIM System</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {filteredNav.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200
                ${isActive 
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }
              `}
            >
              <span className="text-lg">{item.icon}</span>
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-700/50">
        <div className="px-4 py-2 text-xs text-slate-500">
          Role: <span className="text-slate-400 capitalize">{userRole}</span>
        </div>
      </div>
    </aside>
  )
}

