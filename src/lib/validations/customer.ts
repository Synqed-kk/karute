import { z } from 'zod'

export const createCustomerSchema = z.object({
  name: z.string().min(1, '名前を入力してください'),
  nameKana: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('正しいメールアドレスを入力してください').optional().or(z.literal('')),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
})

export const updateCustomerSchema = createCustomerSchema
  .omit({ tags: true })
  .partial()
  .extend({
    id: z.string().uuid(),
    tags: z.array(z.string()).optional(),
  })

export type CreateCustomerInput = z.input<typeof createCustomerSchema>
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>
