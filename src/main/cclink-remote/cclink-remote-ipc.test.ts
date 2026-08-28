import { describe, expect, it } from 'vitest'
import {
  cclinkCancelAgentImageUploadInputSchema,
  cclinkRemotePathSchema,
  cclinkRemoteRefSchema,
  cclinkSendAgentMessageInputSchema,
  cclinkStopTrackingAgentRunInputSchema,
} from './cclink-remote-ipc'

describe('CCLink remote IPC schema', () => {
  it('接受有界的 CCLink RemoteWorkspaceRef', () => {
    expect(
      cclinkRemoteRefSchema.parse({
        kind: 'remote',
        transport: 'cclink',
        endpointId: 'agent-1',
        workspaceId: 'workspace-1',
        path: '/srv/project',
      }),
    ).toMatchObject({ endpointId: 'agent-1', path: '/srv/project' })
  })

  it('拒绝未知字段、空字符路径和超长输入', () => {
    expect(() =>
      cclinkRemoteRefSchema.parse({
        kind: 'remote',
        transport: 'cclink',
        endpointId: 'agent-1',
        workspaceId: 'workspace-1',
        path: '/srv/project',
        refreshToken: 'must-not-cross-preload',
      }),
    ).toThrow()
    expect(() => cclinkRemotePathSchema.parse('/srv/project\0secret')).toThrow()
    expect(() => cclinkRemotePathSchema.parse(`/${'x'.repeat(4097)}`)).toThrow()
    expect(() => cclinkRemotePathSchema.parse('C:relative\\project')).toThrow()
    expect(() => cclinkRemotePathSchema.parse('relative/project')).toThrow()
    expect(() => cclinkRemotePathSchema.parse('C:\\project/mixed')).toThrow()
    expect(cclinkRemotePathSchema.parse('C:\\project\\src')).toBe('C:\\project\\src')
    expect(cclinkRemotePathSchema.parse('\\\\server\\share\\project')).toBe(
      '\\\\server\\share\\project',
    )
  })

  it('accepts image-only remote Agent messages and rejects malformed image bytes', () => {
    const image = {
      id: 'image-1',
      name: 'screen.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }
    const input = {
      ref: {
        kind: 'remote' as const,
        transport: 'cclink' as const,
        endpointId: 'agent-1',
        workspaceId: 'workspace-1',
        path: '/srv/project',
      },
      sessionId: 'session-1',
      content: '',
      images: [image],
      imageUploadId: '6e168c6e-82d8-4c8c-8092-1a3666704368',
    }

    expect(cclinkSendAgentMessageInputSchema.parse(input)).toEqual(input)
    expect(() =>
      cclinkSendAgentMessageInputSchema.parse({
        ...input,
        images: [{ ...image, data: 'not-base64!' }],
      }),
    ).toThrow('图片数据不是有效 Base64')
    expect(() =>
      cclinkSendAgentMessageInputSchema.parse({ ...input, images: [], content: '   ' }),
    ).toThrow('远程消息必须包含文字或图片')
    expect(() =>
      cclinkSendAgentMessageInputSchema.parse({ ...input, imageUploadId: undefined }),
    ).toThrow('远程图片消息缺少上传任务 ID')
  })

  it('accepts only a bounded workspace/session target for stopping local tracking', () => {
    const input = {
      ref: cclinkRemoteRefSchema.parse({
        kind: 'remote',
        transport: 'cclink',
        endpointId: 'agent-1',
        workspaceId: 'workspace-1',
        path: '/srv/project',
      }),
      sessionId: 'session-1',
    }

    expect(cclinkStopTrackingAgentRunInputSchema.parse(input)).toEqual(input)
    expect(() =>
      cclinkStopTrackingAgentRunInputSchema.parse({ ...input, cancelAll: true }),
    ).toThrow()
  })

  it('accepts only a UUID for cancelling one image upload', () => {
    expect(
      cclinkCancelAgentImageUploadInputSchema.parse({
        uploadId: '6e168c6e-82d8-4c8c-8092-1a3666704368',
      }),
    ).toEqual({ uploadId: '6e168c6e-82d8-4c8c-8092-1a3666704368' })
    expect(() => cclinkCancelAgentImageUploadInputSchema.parse({ uploadId: 'all' })).toThrow()
    expect(() =>
      cclinkCancelAgentImageUploadInputSchema.parse({
        uploadId: '6e168c6e-82d8-4c8c-8092-1a3666704368',
        cancelAll: true,
      }),
    ).toThrow()
  })
})
