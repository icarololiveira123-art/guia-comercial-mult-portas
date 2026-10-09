// Public endpoint only. Credentials stay in the backend; GitHub Pages hosts
// the frontend. An explicit empty override supports legacy-mode verification.
export const sharedApiBaseUrl = import.meta.env?.VITE_SHARED_API_URL ?? "https://duywnshiwiqkvicrdxdt.supabase.co/functions/v1/mult-portas-api";
