import { listCustomerPhotos } from '@/actions/customers'
import { scopeKarutePhotos } from '@/lib/karute/scoped-photos'
import { PhotoRecordsCard } from './PhotoRecordsCard'

// Async server component used inside a Suspense boundary on the karute detail
// page. The photos fetch hits synqed-core + object storage, so deferring it lets
// the page shell paint before the HTTP roundtrip resolves.
//
// Scoping: the customer-level fetch returns ALL of the customer's photos (the
// customer page's aggregate view); a karute page must show ONLY the photos
// taken in ITS recording session — scopeKarutePhotos is the single source of
// truth for that rule (shared with the device screen facade).
export async function PhotoRecordsServer({
  customerId,
  recordingSessionId,
}: {
  customerId: string
  recordingSessionId: string | null
}) {
  const result = await listCustomerPhotos(customerId).catch(() => ({
    photos: [] as Array<{
      id: string
      signed_url: string | null
      category: string
      caption: string | null
      recording_session_id: string | null
    }>,
  }))
  const scoped = scopeKarutePhotos(result.photos ?? [], recordingSessionId)
  const photos = scoped.map((p) => ({
    id: p.id,
    signedUrl: p.signed_url,
    category: p.category,
    caption: p.caption,
  }))
  return <PhotoRecordsCard photos={photos} />
}
