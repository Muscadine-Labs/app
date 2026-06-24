/** Public app origin for metadata, Farcaster manifest, and mini app embeds. */
export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://app.muscadine.io'
  );
}
