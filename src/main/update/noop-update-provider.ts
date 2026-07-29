import type {
  UpdateProvider,
  UpdateProviderCheckInput,
  UpdateProviderCheckResult,
} from './update-provider'

export class NoopUpdateProvider implements UpdateProvider {
  readonly id = 'noop'

  async check(_input: UpdateProviderCheckInput): Promise<UpdateProviderCheckResult> {
    return { status: 'disabled', reason: 'provider_unavailable' }
  }
}
