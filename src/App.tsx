import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import Index from "./pages/Index";
import ImportCFRData from "./pages/ImportCFRData";
import Unsubscribe from "./pages/Unsubscribe";
import VacancyFeedback from "./pages/VacancyFeedback";
import PipelineMonitoring from "./pages/PipelineMonitoring";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Consultants from "./pages/Consultants";
import MyPatch from "./pages/MyPatch";
import Alerts from "./pages/Alerts";
import Spend from "./pages/Spend";
import Trusts from "./pages/Trusts";
import Trust from "./pages/Trust";
import Tenders from "./pages/Tenders";
import MapPage from "./pages/MapPage";
import Shortlists from "./pages/Shortlists";
import FollowUps from "./pages/FollowUps";
import Shortlist from "./pages/Shortlist";
import { AuthProvider } from "./lib/auth";
import { RequireAuth } from "./components/RequireAuth";
import { RequireFeature } from "./components/RequireFeature";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <PageErrorBoundary>
        <AuthProvider>
          <Routes>
            {/* Public: sign-in and the pages email links open */}
            <Route path="/login" element={<Login />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route path="/feedback" element={<VacancyFeedback />} />
            {/* Everything else needs a signed-in WhoFoundWho user */}
            <Route element={<RequireAuth />}>
              <Route path="/" element={<MyPatch />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/spend" element={<Spend />} />
              <Route path="/trusts" element={<Trusts />} />
              <Route path="/trusts/:uid" element={<Trust />} />
              <Route path="/tenders" element={<Tenders />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/companies" element={<Index />} />
              <Route path="/companies/:id" element={<Index />} />
              <Route path="/consultants" element={<Consultants />} />
              <Route path="/import-cfr" element={<ImportCFRData />} />
              <Route path="/pipeline-monitoring" element={<PipelineMonitoring />} />
              {/* Hidden behind profiles.features.follow_ups */}
              <Route element={<RequireFeature feature="follow_ups" />}>
                <Route path="/follow-ups" element={<FollowUps />} />
              </Route>
              {/* Hidden behind profiles.features.crm_shortlister: a 404 for everyone else */}
              <Route element={<RequireFeature feature="crm_shortlister" />}>
                <Route path="/shortlists" element={<Shortlists />} />
                <Route path="/shortlists/:id" element={<Shortlist />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
        </PageErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
