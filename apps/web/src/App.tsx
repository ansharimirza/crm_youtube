import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/contexts/auth'
import { Sidebar } from '@/components/Sidebar'
import { MobileTopbar } from '@/components/MobileTopbar'
import { LoginPage } from '@/pages/Login'
import { RegisterPage } from '@/pages/Register'
import { DashboardPage } from '@/pages/Dashboard'
import { UploadHubPage } from '@/pages/UploadHub'
import { SettingsPage } from '@/pages/Settings'
import { AdminPage } from '@/pages/Admin'
import { YoutubeCallbackPage } from '@/pages/YoutubeCallback'
import { VeoStudioPage } from '@/pages/VeoStudio'
import { VeoProjectPage } from '@/pages/VeoProject'
import { FacelessStudioPage } from '@/pages/FacelessStudio'
import { FacelessProjectPage } from '@/pages/FacelessProject'
import { TranscribePage } from '@/pages/Transcribe'
import { AnalyzerPage } from '@/pages/Analyzer'
import { ViralityPage } from '@/pages/Virality'
import { ResumePage } from '@/pages/Resume'
import { TiktokStudioPage } from '@/pages/TiktokStudio'
import { TiktokNewPage } from '@/pages/TiktokNew'
import { TiktokCampaignPage } from '@/pages/TiktokCampaign'
import { AiInfluencerStudioPage } from '@/pages/AiInfluencerStudio'
import { AiInfluencerNewPage } from '@/pages/AiInfluencerNew'
import { AiInfluencerDetailPage } from '@/pages/AiInfluencerDetail'
import { MotionStudioPage } from '@/pages/MotionStudio'
import { MotionNewPage } from '@/pages/MotionNew'
import { MotionDetailPage } from '@/pages/MotionDetail'

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
  },
})

function ProtectedLayout() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileTopbar />
        <main className="flex-1 p-4 md:p-8 gradient-bg">
          <div className="max-w-6xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

function AdminGuard() {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/youtube-callback" element={<YoutubeCallbackPage />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/upload" element={<UploadHubPage />} />
              <Route path="/bulk-upload" element={<UploadHubPage defaultTab="bulk" />} />
              <Route path="/veo" element={<VeoStudioPage />} />
              <Route path="/veo/:id" element={<VeoProjectPage />} />
              <Route path="/faceless" element={<FacelessStudioPage />} />
              <Route path="/faceless/:id" element={<FacelessProjectPage />} />
              <Route path="/transcribe" element={<TranscribePage />} />
              <Route path="/analyzer" element={<AnalyzerPage />} />
              <Route path="/virality" element={<ViralityPage />} />
              <Route path="/resume" element={<ResumePage />} />
              <Route path="/tiktok" element={<TiktokStudioPage />} />
              <Route path="/tiktok/new" element={<TiktokNewPage />} />
              <Route path="/tiktok/:id" element={<TiktokCampaignPage />} />
              <Route path="/influencer" element={<AiInfluencerStudioPage />} />
              <Route path="/influencer/new" element={<AiInfluencerNewPage />} />
              <Route path="/influencer/:id" element={<AiInfluencerDetailPage />} />
              <Route path="/motion" element={<MotionStudioPage />} />
              <Route path="/motion/new" element={<MotionNewPage />} />
              <Route path="/motion/:id" element={<MotionDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route element={<AdminGuard />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
      <Toaster position="top-right" theme="dark" richColors />
    </QueryClientProvider>
  )
}
