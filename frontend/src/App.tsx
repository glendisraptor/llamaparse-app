import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import CompanyProfileExtractor from "./CompanyProfileExtractor"

function App() {

  const queryClient = new QueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <CompanyProfileExtractor />
    </QueryClientProvider>
  )
}

export default App
