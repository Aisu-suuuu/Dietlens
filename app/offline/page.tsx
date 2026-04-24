/**
 * Offline fallback page.
 * Served by the service worker when navigation fails and no cached version exists.
 * Styling agents will layer design-token styles on top of this scaffold.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="mb-3 text-2xl font-semibold">You&apos;re offline.</h1>
      <p className="max-w-sm text-base leading-relaxed">
        DietLens needs a connection to load new photos — your queued meals will
        sync when you&apos;re back online.
      </p>
    </main>
  );
}
