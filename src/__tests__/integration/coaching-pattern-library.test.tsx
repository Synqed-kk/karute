/**
 * @jest-environment jsdom
 *
 * Render coverage for PatternLibrary + PatternCategorySection
 * (PR 26, replay/26). Real logic: PatternLibrary always renders
 * all five fixed category sections (even with no data), buckets
 * patterns into the right section by `category`, and derives
 * showSource from the effective role. PatternCategorySection
 * shows its heading+description always and a scaffold hint when
 * its bucket is empty.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'en',
}))

// The dev-preview override is off in tests; the effective role is
// the real role passed in. Mock it explicitly so the test does not
// depend on NODE_ENV / localStorage state.
jest.mock('@/lib/coaching-dev-preview/hooks', () => ({
  useEffectiveCoachingRole: (realRole: 'owner' | 'staff') => realRole,
}))

import { PatternLibrary } from '@/components/coaching/redesign/PatternLibrary'
import { PatternCategorySection } from '@/components/coaching/redesign/PatternCategorySection'
import type { TopPerformerPattern } from '@/components/coaching/redesign/LearnFromTopCard'

function pattern(over: Partial<TopPerformerPattern> = {}): TopPerformerPattern {
  return {
    id: 'p1',
    categoryLabel: 'クロージング',
    title: 'パターン',
    description: '説明',
    ...over,
  }
}

describe('PatternLibrary', () => {
  it('renders all five category sections even with no data wired', () => {
    render(<PatternLibrary viewerRealRole="staff" patterns={null} />)
    // tCat is scoped to 'coaching.patterns.categories', so the mocked
    // translator renders each section title as the leaf key "<cat>.title".
    const titles = screen.getAllByText(/^[a-z_]+\.title$/)
    expect(titles).toHaveLength(5)
  })

  it('shows the staff subtitle for a staff viewer', () => {
    render(<PatternLibrary viewerRealRole="staff" patterns={[]} />)
    expect(screen.getByText('subtitleStaff')).toBeInTheDocument()
    expect(screen.queryByText('subtitleOwner')).not.toBeInTheDocument()
  })

  it('shows the owner subtitle for an owner viewer', () => {
    render(<PatternLibrary viewerRealRole="owner" patterns={[]} />)
    expect(screen.getByText('subtitleOwner')).toBeInTheDocument()
  })

  it('buckets a pattern into its category section and renders its title', () => {
    render(
      <PatternLibrary
        viewerRealRole="owner"
        patterns={[
          pattern({ id: 'a', category: 'closing', title: 'クロージングの極意' }),
        ]}
      />,
    )
    expect(screen.getByText('クロージングの極意')).toBeInTheDocument()
  })

  it('shows the source staff name to an owner but not to a staff viewer', () => {
    const p = pattern({
      id: 's',
      category: 'closing',
      title: 'ソース付き',
      sourceStaffName: '山田',
    })
    const { rerender } = render(
      <PatternLibrary viewerRealRole="owner" patterns={[p]} />,
    )
    expect(screen.getByText('山田')).toBeInTheDocument()

    rerender(<PatternLibrary viewerRealRole="staff" patterns={[p]} />)
    expect(screen.queryByText('山田')).not.toBeInTheDocument()
  })
})

describe('PatternCategorySection', () => {
  it('renders the heading and description always', () => {
    render(
      <PatternCategorySection
        title="クロージング"
        description="購入の後押し"
        patterns={[]}
        showSource={false}
      />,
    )
    expect(screen.getByText('クロージング')).toBeInTheDocument()
    expect(screen.getByText('購入の後押し')).toBeInTheDocument()
  })

  it('shows a scaffold hint when its bucket is empty', () => {
    render(
      <PatternCategorySection
        title="クロージング"
        description="購入の後押し"
        patterns={[]}
        showSource={false}
      />,
    )
    expect(screen.getByText('sectionEmptyHint')).toBeInTheDocument()
  })

  it('renders one card per pattern when the bucket has data', () => {
    render(
      <PatternCategorySection
        title="クロージング"
        description="購入の後押し"
        patterns={[
          pattern({ id: '1', title: 'カードA' }),
          pattern({ id: '2', title: 'カードB' }),
        ]}
        showSource={false}
      />,
    )
    expect(screen.getByText('カードA')).toBeInTheDocument()
    expect(screen.getByText('カードB')).toBeInTheDocument()
    expect(screen.queryByText('sectionEmptyHint')).not.toBeInTheDocument()
  })
})
