// NO 'use client' directive — this component is used only in the PDF route handler (server-side).
// react-pdf components run under their own React reconciler and do not support React hooks or context.
import path from 'path'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'
import type { KaruteWithRelations } from '@/lib/supabase/karute'

// Register fonts at MODULE LEVEL — runs once when the module is first imported.
// Registering inside the component body would re-register on every request.
// process.cwd() returns the Next.js project root in both dev and production.
Font.register({
  family: 'NotoSansJP',
  fonts: [
    {
      src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf'),
      fontWeight: 'normal',
    },
    {
      src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Bold.ttf'),
      fontWeight: 'bold',
    },
  ],
})

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 10,
    padding: 40,
    lineHeight: 1.6,
    color: '#1a1a1a',
  },
  heading: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  dateLine: {
    fontSize: 10,
    color: '#555555',
    marginBottom: 12,
  },
  subheading: {
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
    paddingBottom: 4,
  },
  text: {
    marginBottom: 4,
  },
  entryContainer: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 4,
  },
  entryCategory: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#555555',
    marginBottom: 2,
  },
  entrySourceQuote: {
    fontSize: 9,
    color: '#666666',
    fontStyle: 'italic',
    marginTop: 2,
  },
})

interface KarutePdfDocumentProps {
  karute: KaruteWithRelations
}

export function KarutePdfDocument({ karute }: KarutePdfDocumentProps) {
  // customers is aliased as `customers:client_id` in the PostgREST query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerName = (karute as any).customers?.name ?? '—'
  const date = new Date(karute.session_date ?? karute.created_at).toLocaleDateString('ja-JP')

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Title */}
        <Text style={styles.heading}>{customerName} — カルテ</Text>
        <Text style={styles.dateLine}>{date}</Text>

        {/* AI Summary section */}
        <Text style={styles.subheading}>AI サマリー</Text>
        <Text style={styles.text}>{karute.summary ?? ''}</Text>

        {/* Entries section */}
        <Text style={styles.subheading}>エントリー</Text>
        {(karute.entries ?? []).map((entry) => (
          <View key={entry.id} style={styles.entryContainer}>
            <Text style={styles.entryCategory}>{entry.category}</Text>
            <Text style={styles.text}>{entry.content}</Text>
            {entry.source_quote ? (
              <Text style={styles.entrySourceQuote}>
                &quot;{entry.source_quote}&quot;
              </Text>
            ) : null}
          </View>
        ))}

        {/* Transcript section */}
        <Text style={styles.subheading}>トランスクリプト</Text>
        <Text style={styles.text}>{karute.transcript ?? ''}</Text>
      </Page>
    </Document>
  )
}
