import { z } from 'zod'
import {
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_BASE64_LENGTH,
  MAX_AGENT_IMAGE_PAYLOAD_BYTES,
  MAX_AGENT_SOURCE_IMAGE_BYTES,
  MAX_AGENT_SOURCE_IMAGE_EDGE,
  MAX_AGENT_IMAGE_EDGE,
} from '../agent-image-limits'
import { boundedIdentifierSchema, boundedJsonValueSchema, boundedTextSchema } from './input-schema'

export const agentImageSchema = z
  .object({
    id: boundedIdentifierSchema(),
    name: boundedTextSchema(512).trim().min(1),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
    data: z
      .string()
      .min(1)
      .max(MAX_AGENT_IMAGE_BASE64_LENGTH)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, '图片数据不是有效 Base64'),
    size: z.number().int().positive().max(MAX_AGENT_IMAGE_BYTES),
    preparation: z
      .object({
        originalSize: z.number().int().positive().max(MAX_AGENT_SOURCE_IMAGE_BYTES),
        originalWidth: z.number().int().positive().max(MAX_AGENT_SOURCE_IMAGE_EDGE),
        originalHeight: z.number().int().positive().max(MAX_AGENT_SOURCE_IMAGE_EDGE),
        width: z.number().int().positive().max(MAX_AGENT_IMAGE_EDGE),
        height: z.number().int().positive().max(MAX_AGENT_IMAGE_EDGE),
        firstFrameOnly: z.boolean(),
        requiresReview: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (image) => {
      const padding = image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0
      return image.data.length % 4 === 0 && (image.data.length / 4) * 3 - padding === image.size
    },
    { message: '图片数据大小校验失败' },
  )

export const agentImagesSchema = z
  .array(agentImageSchema)
  .max(MAX_AGENT_IMAGES)
  .and(boundedJsonValueSchema(MAX_AGENT_IMAGE_PAYLOAD_BYTES, 'Agent 图片附件'))
