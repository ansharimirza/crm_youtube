import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, XCircle, Clock, Calendar } from 'lucide-react'
import type { VideoStatus } from '@/lib/types'

interface Props {
  status: VideoStatus
  className?: string
}

export function StatusBadge({ status, className }: Props) {
  const config = {
    queued:     { variant: 'warning' as const, icon: Clock,       label: 'Antrian' },
    uploading:  { variant: 'info' as const,    icon: Loader2,     label: 'Uploading' },
    done:       { variant: 'success' as const, icon: CheckCircle2,label: 'Selesai' },
    error:      { variant: 'destructive' as const, icon: XCircle, label: 'Error' },
    scheduled:  { variant: 'purple' as const,  icon: Calendar,    label: 'Terjadwal' },
  }[status]

  const Icon = config.icon
  return (
    <Badge variant={config.variant} className={className}>
      <Icon className={`mr-1 h-3 w-3 ${status === 'uploading' ? 'animate-spin' : ''}`} />
      {config.label}
    </Badge>
  )
}
