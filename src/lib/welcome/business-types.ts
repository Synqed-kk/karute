// Constants for the /welcome setup wizard.
//
// Source of truth: dashboard-data.js in the redesign handoff. Each business
// type ships with a tuned AI profile that's surfaced as a live preview in
// Step 1 — `priorityTopics`, `coachingFocus`, etc. are numbers shown in the
// "Included in this profile" list. Production will replace these with the
// real per-template counts; for now they're the prototype values.

export interface BusinessType {
  value: string
  label: string
}

export interface BusinessProfile {
  label: string
  tagline: string
  priorityTopics: number
  coachingFocus: number
  topPatterns: number
  consultationPrompts: number
  // Drives the 3 prompt cards on the AI Assistant page. Source of truth
  // for what "Tuned for: <type>" actually means at the AI surface.
  consultationQuestions?: ConsultationQuestion[]
}

export interface ConsultationQuestion {
  id: string
  category: 'Analysis' | 'Customer' | 'Strategy'
  title: string
  preview: string
  example: string
}

export const BUSINESS_TYPES: BusinessType[] = [
  { value: 'esthetic_salon', label: 'Esthetic Salon' },
  { value: 'hair_salon', label: 'Hair Salon' },
  { value: 'nail_salon', label: 'Nail Salon' },
  { value: 'eyelash_salon', label: 'Eyelash Salon' },
  { value: 'massage', label: 'Massage' },
  { value: 'chiropractic', label: 'Chiropractic' },
  { value: 'beauty_chiropractic', label: 'Beauty Chiropractic' },
  { value: 'acupuncture', label: 'Acupuncture' },
  { value: 'osteopathy', label: 'Osteopathy' },
  { value: 'yoga_studio', label: 'Yoga Studio' },
  { value: 'pilates_studio', label: 'Pilates Studio' },
  { value: 'personal_gym', label: 'Personal Gym' },
  { value: 'dental_clinic', label: 'Dental Clinic' },
  { value: 'medical_clinic', label: 'Medical Clinic' },
  { value: 'dermatology', label: 'Dermatology' },
  { value: 'cosmetic_surgery', label: 'Cosmetic Surgery' },
  { value: 'physical_therapy', label: 'Physical Therapy' },
  { value: 'foot_care', label: 'Foot Care / Reflexology' },
  { value: 'relaxation', label: 'Relaxation Salon' },
  { value: 'aroma', label: 'Aromatherapy Salon' },
  { value: 'wellness_clinic', label: 'Wellness Clinic' },
  { value: 'mental_health', label: 'Mental Health / Counseling' },
  { value: 'veterinary', label: 'Veterinary Clinic' },
  { value: 'pet_grooming', label: 'Pet Grooming' },
  { value: 'training_school', label: 'Training / Lessons' },
  { value: 'other', label: 'Other' },
]

const GENERIC_CONSULTATION_QUESTIONS: ConsultationQuestion[] = [
  {
    id: 'g-analysis',
    category: 'Analysis',
    title: 'Weekly performance summary',
    preview: 'Top trends in karute, bookings, and rebooking this week',
    example:
      'Summarize this week\'s karute activity, top customers, and any rebooking gaps to follow up on',
  },
  {
    id: 'g-customer',
    category: 'Customer',
    title: 'Customers due for follow-up',
    preview: 'Who hasn\'t been in for 60+ days that we should reach out to',
    example:
      'List customers who haven\'t booked in 60+ days and suggest a re-engagement message for each',
  },
  {
    id: 'g-strategy',
    category: 'Strategy',
    title: 'Next-month campaign ideas',
    preview: 'Promotions tuned to our karute patterns + customer profiles',
    example:
      'Suggest 3 campaign ideas for next month grounded in the kinds of services our customers are asking about',
  },
]

const BUSINESS_TYPE_PROFILES: Record<string, BusinessProfile> = {
  beauty_chiropractic: {
    label: 'Beauty Chiropractic',
    tagline:
      'Pelvic + posture + small-face correction. AI tuned for the hybrid beauty/clinical vocabulary unique to 美容整体.',
    priorityTopics: 14,
    coachingFocus: 6,
    topPatterns: 8,
    consultationPrompts: 12,
    consultationQuestions: [
      {
        id: 'bc-customer',
        category: 'Customer',
        title: 'Bridal-goal customers',
        preview: 'Customers with weddings in the next 6 months — by remaining time',
        example:
          'List customers with weddings in the next 6 months and draft cadence recommendations based on time remaining',
      },
      {
        id: 'bc-analysis',
        category: 'Analysis',
        title: 'Intensive → maintenance conversion',
        preview: '% who graduated from the intensive phase to maintenance, by staff',
        example:
          'Break down intensive→maintenance conversion by staff and analyze what drives the gap',
      },
      {
        id: 'bc-strategy',
        category: 'Strategy',
        title: 'Pre-summer body-shape course',
        preview: '3-month pelvic + body-shape course — weekly cadence + pricing',
        example:
          'Draft a 3-month pelvic + body-shape pre-summer course with weekly cadence design and pricing',
      },
    ],
  },
  esthetic_salon: {
    label: 'Esthetic Salon',
    tagline:
      'Facial + body care. AI tuned for skin condition tracking, seasonal flare patterns, and product fit.',
    priorityTopics: 12,
    coachingFocus: 5,
    topPatterns: 7,
    consultationPrompts: 10,
    consultationQuestions: [
      {
        id: 'es-customer',
        category: 'Customer',
        title: 'Sensitive-skin alerts',
        preview: 'Customers whose recent karute flagged sensitivity or flare-ups',
        example:
          'List customers who have flagged sensitive-skin or seasonal flare-ups in recent karute and propose a product/timing adjustment for each',
      },
      {
        id: 'es-analysis',
        category: 'Analysis',
        title: 'Course completion rate',
        preview: '% who completed their 5-session course vs dropped mid-way',
        example:
          'Analyze 5-session course completion rate over the last 90 days and identify drop-off patterns',
      },
      {
        id: 'es-strategy',
        category: 'Strategy',
        title: 'Seasonal flare campaign',
        preview: 'Pollen / dryness moisture-boost plan for the next 6 weeks',
        example:
          'Draft a 6-week seasonal-flare moisture-boost plan targeting customers with pollen or dryness concerns',
      },
    ],
  },
  hair_salon: {
    label: 'Hair Salon',
    tagline:
      'Cut, color, treatment. AI tuned for style preferences, hair health, and seasonal regrowth patterns.',
    priorityTopics: 11,
    coachingFocus: 4,
    topPatterns: 6,
    consultationPrompts: 9,
    consultationQuestions: [
      {
        id: 'hs-customer',
        category: 'Customer',
        title: 'Color-fade follow-up',
        preview: 'Customers missing rebook after their last color treatment',
        example:
          'List customers who had a color treatment in the past 6-8 weeks but no rebook on the books, with a draft message for each',
      },
      {
        id: 'hs-analysis',
        category: 'Analysis',
        title: 'Retail sales stagnation',
        preview: 'Why product attach rate is flat — by service category and staff',
        example:
          'Analyze why retail product attach rate has been flat and break it down by service category and staff',
      },
      {
        id: 'hs-strategy',
        category: 'Strategy',
        title: 'Rainy-season humidity care',
        preview: 'June campaign for frizz-prone customers',
        example:
          'Draft a June humidity-care campaign targeting customers with frizz or anti-humidity concerns in recent karute',
      },
    ],
  },
  massage: {
    label: 'Massage',
    tagline:
      'Body tension and recovery. AI tuned for chronic pain patterns and posture / activity correlations.',
    priorityTopics: 10,
    coachingFocus: 5,
    topPatterns: 6,
    consultationPrompts: 8,
    consultationQuestions: GENERIC_CONSULTATION_QUESTIONS,
  },
  dermatology: {
    label: 'Dermatology',
    tagline:
      'Clinical skin care. AI tuned for diagnosis tracking, prescription history, and treatment response.',
    priorityTopics: 16,
    coachingFocus: 7,
    topPatterns: 10,
    consultationPrompts: 14,
    consultationQuestions: GENERIC_CONSULTATION_QUESTIONS,
  },
}

const DEFAULT_PROFILE: BusinessProfile = {
  label: 'General',
  tagline:
    'AI tuned to general consultation patterns. Pick a more specific type if your business has specialized terminology.',
  priorityTopics: 8,
  coachingFocus: 3,
  topPatterns: 5,
  consultationPrompts: 6,
  consultationQuestions: GENERIC_CONSULTATION_QUESTIONS,
}

export function getConsultationQuestions(
  businessType: string | null | undefined,
): ConsultationQuestion[] {
  const profile = getBusinessProfile(businessType ?? null)
  return profile.consultationQuestions ?? GENERIC_CONSULTATION_QUESTIONS
}

export function getBusinessProfile(value: string | null): BusinessProfile {
  if (!value) return DEFAULT_PROFILE
  return BUSINESS_TYPE_PROFILES[value] ?? DEFAULT_PROFILE
}

export interface DisclosureMode {
  mode: 'A' | 'B' | 'C'
  label: string
  summary: string
  description: string
  recommendedFor: string
}

export const DISCLOSURE_MODES: DisclosureMode[] = [
  {
    mode: 'A',
    label: 'Discreet (seamless)',
    summary: 'Records automatically at session start. No customer-facing popup.',
    description:
      'The legally permitted default in Japan. Customers see no popup; APPI compliance is satisfied by the purpose-of-use disclosed in your privacy policy. Only staff see a subtle recording indicator. Requires that your privacy policy already discloses AI recording.',
    recommendedFor: 'Salons prioritizing seamless UX',
  },
  {
    mode: 'B',
    label: 'Verbal disclosure (recommended)',
    summary: 'Before the first recording with a new customer, staff mentions it verbally.',
    description:
      'Staff say something like "today\'s consultation will be AI-assisted." A suggested script appears for staff. If the customer objects, recording can be disabled for that session.',
    recommendedFor: 'Salons that value transparency',
  },
  {
    mode: 'C',
    label: 'Explicit consent (highest trust)',
    summary:
      'First visit: tablet consent screen. Subsequent visits auto-apply the stored consent.',
    description:
      'On first visit, the customer sees a tablet screen explaining AI support with accept / decline. Consent is stored on the customer record and auto-applied on future visits.',
    recommendedFor: 'Recommended for medical / clinical (dermatology, chiro, dental)',
  },
]
