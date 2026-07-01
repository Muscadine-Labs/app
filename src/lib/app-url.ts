/** Public app origin for metadata and Base Account connector (appUrl). */
export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://app.muscadine.xyz'
  );
}
