import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import Index from "./pages/Index";
import Unsubscribe from "./pages/Unsubscribe";
import VacancyFeedback from "./pages/VacancyFeedback";
import PipelineMonitoring from "./pages/PipelineMonitoring";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Consultants from "./pages/Consultants";
import MyPatch from "./pages/MyPatch";
import Alerts from "./pages/Alerts";
import { AuthProvider } from "./lib/auth";
import { RequireAuth } from "./components/RequireAuth";

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
            {/* Everything else needs a signed-in user with a profile */}
            <Route element={<RequireAuth />}>
              <Route path="/" element={<MyPatch />} />
              <Route path="/companies" element={<Index />} />
              <Route path="/companies/:id" element={<Index />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/consultants" element={<Consultants />} />
              <Route path="/pipeline-monitoring" element={<PipelineMonitoring />} />
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
