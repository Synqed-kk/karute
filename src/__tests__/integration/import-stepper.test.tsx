/**
 * @jest-environment jsdom
 *
 * Render coverage for ImportStepper (PR 23, replay/23): the 4-step progress
 * indicator. next-intl is mocked so step labels render as their translation
 * KEYs. Active/completed/future state is asserted via the chip class names
 * (solid blue = active, bordered blue = done, muted = future).
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { ImportStepper } from '@/components/data-import/ImportStepper'

const STEP_KEYS = ['stepUpload', 'stepMapping', 'stepValidate', 'stepDone']

// The chip (the rounded icon circle) is the closest element to the step
// number/label that carries the state classes.
function chipForStep(stepIndex: number): HTMLElement {
  // The number label is rendered as "1. <key>"; find its row, then the chip.
  const label = screen.getByText(`${stepIndex + 1}.`, { exact: false })
  // label span is sibling of the chip inside the "flex items-center gap-2" wrapper
  const row = label.parentElement as HTMLElement
  const chip = row.querySelector('div.rounded-full') as HTMLElement
  return chip
}

describe('ImportStepper', () => {
  it('renders all four step labels as their i18n keys', () => {
    render(<ImportStepper activeStep={0} />)
    for (const key of STEP_KEYS) {
      expect(screen.getByText(key)).toBeInTheDocument()
    }
  })

  it('renders the 1-based step numbers', () => {
    render(<ImportStepper activeStep={0} />)
    for (let i = 1; i <= 4; i++) {
      expect(screen.getByText(`${i}.`, { exact: false })).toBeInTheDocument()
    }
  })

  it('highlights the active step with a solid blue chip', () => {
    render(<ImportStepper activeStep={1} />)
    const chip = chipForStep(1)
    expect(chip.className).toContain('bg-blue-600')
    expect(chip.className).toContain('text-white')
  })

  it('marks steps before the active step as completed (bordered blue chip)', () => {
    render(<ImportStepper activeStep={2} />)
    const chip = chipForStep(0)
    expect(chip.className).toContain('bg-blue-100')
    expect(chip.className).toContain('border-blue-300')
    // not the active solid style
    expect(chip.className).not.toContain('bg-blue-600')
  })

  it('marks steps after the active step as future (muted chip)', () => {
    render(<ImportStepper activeStep={0} />)
    const chip = chipForStep(3)
    expect(chip.className).toContain('bg-gray-100')
    expect(chip.className).not.toContain('bg-blue-600')
    expect(chip.className).not.toContain('bg-blue-100')
  })

  it('treats the final step as active when activeStep points at it', () => {
    render(<ImportStepper activeStep={3} />)
    const chip = chipForStep(3)
    expect(chip.className).toContain('bg-blue-600')
    // every earlier step is then completed
    expect(chipForStep(0).className).toContain('bg-blue-100')
    expect(chipForStep(2).className).toContain('bg-blue-100')
  })
})
