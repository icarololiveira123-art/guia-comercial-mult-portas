// This is a public endpoint, not a credential. It is filled only after the
// shared API has been deployed and verified. GitHub Pages remains the frontend.
export const sharedApiBaseUrl = import.meta.env?.VITE_SHARED_API_URL ?? "";
