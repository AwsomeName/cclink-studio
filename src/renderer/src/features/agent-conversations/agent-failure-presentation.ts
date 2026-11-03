import { isContextCompactionFailure } from '@shared/agent-failure'

export function agentFailurePresentation(code?: string | null): {
  title: string
  detail: string
} {
  const title = isContextCompactionFailure(code) ? '上下文压缩失败' : 'Agent 运行失败'
  switch (code) {
    case 'context_compaction_content_rejected':
      return {
        title,
        detail:
          '模型服务以内容安全或敏感内容为由拒绝了压缩请求，未能生成摘要。无法确定具体由哪段内容触发。',
      }
    case 'context_compaction_context_limit':
      return { title, detail: '对话上下文超过模型服务的限制，压缩未能完成。' }
    case 'context_compaction_authentication_failed':
    case 'authentication_failed':
      return {
        title: isContextCompactionFailure(code) ? title : '模型服务认证失败',
        detail: '模型服务拒绝了当前凭证。请在设置中检查 API Key、端点和模型权限。',
      }
    case 'context_compaction_rate_limited':
    case 'rate_limited':
      return {
        title: isContextCompactionFailure(code) ? title : '模型服务限流',
        detail: '模型服务触发了频率限制，请稍后重试。',
      }
    case 'context_compaction_network_unavailable':
    case 'network_unavailable':
      return {
        title: isContextCompactionFailure(code) ? title : '模型服务连接失败',
        detail: '无法稳定连接模型服务，请检查网络、DNS 和代理设置。',
      }
    case 'context_compaction_proxy_gateway_error':
    case 'proxy_gateway_error':
      return {
        title: isContextCompactionFailure(code) ? title : '模型服务网关异常',
        detail: '服务端、代理或网关返回了不可解析的响应，请检查 API 地址和代理设置。',
      }
    case 'content_rejected':
      return { title: '模型服务拒绝内容', detail: '模型服务以内容安全或敏感内容为由拒绝了请求。' }
    case 'context_limit_exceeded':
      return {
        title: '上下文超过限制',
        detail: '对话上下文超过模型服务的限制，请压缩上下文或新建对话。',
      }
    case 'context_compaction_failed':
      return {
        title,
        detail: '未能完成上下文压缩，请展开原始错误查看模型服务或 Runtime 返回的原因。',
      }
    case 'browser_task_waiting_human':
      return { title: '任务暂停', detail: '' }
    case 'browser_reobservation_required':
      return { title: '任务待核验', detail: '' }
    default:
      return { title, detail: '' }
  }
}
