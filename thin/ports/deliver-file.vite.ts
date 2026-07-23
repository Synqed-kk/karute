// DataPort.deliverFile — thin/Vite impl (packet 23, /data-export port). A
// SIBLING module, not inline in data.vite.ts: that file imports ../env,
// which reads import.meta.env — jest cannot parse import.meta at all (see
// thin-port-contract.test.ts's header comment), so anything jest needs to
// unit-test directly has to live somewhere import.meta-free. Pure browser
// API usage, no thin env needed either way.
//
// No share/download plumbing exists anywhere in shell or native (grep-
// proven — Capacitor plugins are SplashScreen + StatusBar only), so this is
// Web Share API level 2 (navigator.share with files) against the WebKit
// webview, with a clipboard fallback. NEVER called from an async fetch
// continuation — WebKit requires a user gesture for share(); the view
// settles into 'done' and a tap calls this synchronously.
export async function deliverFile(
  blob: Blob,
  fileName: string,
): Promise<'downloaded' | 'shared' | 'copied'> {
  const file = new File([blob], fileName, { type: blob.type })
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean
    share?: (data: { files: File[] }) => Promise<void>
  }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share!({ files: [file] })
      return 'shared'
    } catch (err) {
      // AbortError = the user closed the share sheet — not a failure, no toast.
      if (err instanceof Error && err.name === 'AbortError') return 'shared'
      // Any other share failure falls through to the clipboard fallback below.
    }
  }
  // Fallback assumes TEXT formats — true for everything wired today
  // (customers + csv/json); a future binary format (xlsx) must not reach this
  // line. Guarded existence per the repo convention (MessageComposeDialog):
  // clipboard absent → throw → the view's exportFailed toast, never a silent
  // 'copied' lie.
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('no delivery mechanism available (share and clipboard both missing)')
  }
  await navigator.clipboard.writeText(await blob.text())
  return 'copied'
}
