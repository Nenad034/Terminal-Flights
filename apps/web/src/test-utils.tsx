import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

// Zajednički helper za testove komponenti koje koriste TanStack Query
// (useQuery/useMutation) — svaka komponenta u apps/web pretpostavlja da je
// obavijena u QueryClientProvider (§19, providers.tsx).
export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
