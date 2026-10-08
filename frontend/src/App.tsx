import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar, type Page } from "@/components/AppSidebar"
import { useRoute } from "@/hooks/use-route"
import { useAuth } from "@/hooks/use-auth"
import HomePage from "@/pages/HomePage"
import ConsolePage from "@/pages/ConsolePage"
import CommandsPage from "@/pages/CommandsPage"
import SettingsPage from "@/pages/SettingsPage"
import FirmwarePage from "@/pages/FirmwarePage"
import LoginPage from "@/pages/LoginPage"

function PageContent({ page }: { page: Page }) {
  switch (page) {
    case "home":
      return <HomePage />
    case "console":
      return <ConsolePage />
    case "commands":
      return <CommandsPage />
    case "settings":
      return <SettingsPage />
    case "firmware":
      return <FirmwarePage />
  }
}

export default function App() {
  const { authenticated, checking } = useAuth()
  const { page, navigate } = useRoute()

  if (checking) return null   // stored token being validated — avoid login-page flash
  if (!authenticated) return <LoginPage />

  return (
    <SidebarProvider>
      <AppSidebar currentPage={page} onNavigate={navigate} />
      <main className="flex h-screen w-full min-w-0 flex-col overflow-hidden p-6">
        <SidebarTrigger className="shrink-0 md:hidden" />
        {/* relative: an absolutely positioned descendant with no positioned ancestor
            in here (radix's hidden form <input> behind a Switch) is otherwise laid
            out against the page, not this box -- it is not clipped by this
            scroller, and it stretches the DOCUMENT, giving a second scrollbar. */}
        <div className="relative min-h-0 w-full flex-1 overflow-y-auto">
          <PageContent page={page} />
        </div>
      </main>
    </SidebarProvider>
  )
}
