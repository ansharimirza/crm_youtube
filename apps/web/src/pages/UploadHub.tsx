import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Upload as UploadIcon, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UploadPage } from './Upload'
import { BulkUploadPage } from './BulkUpload'

type Tab = 'single' | 'bulk'

export function UploadHubPage({ defaultTab = 'single' }: { defaultTab?: Tab } = {}) {
  const [params] = useSearchParams()
  const isEdit = !!params.get('edit')
  const [tab, setTab] = useState<Tab>(defaultTab)

  // Edit mode is single-video only — render the full Upload page (own header), no tabs.
  if (isEdit) return <UploadPage />

  return (
    <div className="space-y-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Upload Video</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload satu video lengkap, atau banyak sekaligus (bulk).
          </p>
        </div>
        <div className="inline-flex rounded-lg border bg-card/40 p-1">
          <TabBtn active={tab === 'single'} onClick={() => setTab('single')} icon={UploadIcon} label="Satu Video" />
          <TabBtn active={tab === 'bulk'} onClick={() => setTab('bulk')} icon={Layers} label="Bulk Upload" />
        </div>
      </div>

      {tab === 'single' ? <UploadPage embedded /> : <BulkUploadPage embedded />}
    </div>
  )
}

function TabBtn({
  active, onClick, icon: Icon, label,
}: { active: boolean; onClick: () => void; icon: typeof UploadIcon; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}
