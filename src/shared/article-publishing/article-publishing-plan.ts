import type { ArticlePublishingResumePolicy } from './article-publishing-types'

export interface ArticlePublishingPlanStep {
  stepId: string
  label: string
  resumePolicy: ArticlePublishingResumePolicy
}

export const CSDN_ARTICLE_PUBLISHING_PLAN = [
  { stepId: 'open-editor', label: '打开 CSDN 编辑页', resumePolicy: 'reconcile-then-run' },
  { stepId: 'verify-account', label: '核验账号与页面', resumePolicy: 'reconcile-then-run' },
  { stepId: 'upload-assets', label: '上传并核验正文图片', resumePolicy: 'skip-if-verified' },
  { stepId: 'fill-body', label: '填写并核验正文', resumePolicy: 'reconcile-then-run' },
  { stepId: 'fill-fields', label: '填写平台字段', resumePolicy: 'reconcile-then-run' },
  { stepId: 'save-draft', label: '保存并复核草稿', resumePolicy: 'reconcile-then-run' },
  { stepId: 'publish', label: '执行常规单篇发布', resumePolicy: 'manual-only' },
  { stepId: 'verify-publication', label: '核验文章结果', resumePolicy: 'manual-only' },
] as const satisfies readonly ArticlePublishingPlanStep[]
