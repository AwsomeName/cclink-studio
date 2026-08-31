import { createHash } from 'node:crypto'
import type {
  ScheduledTaskDefinition,
  StoredScheduledTaskDefinitionV2,
} from '../../shared/scheduled-task/scheduled-task-types'

type ExecutableDefinition = Pick<
  ScheduledTaskDefinition | StoredScheduledTaskDefinitionV2,
  'id' | 'instruction' | 'schedule' | 'resources' | 'outputPolicy'
>

/**
 * B 机确认绑定的执行语义摘要。展示字段、时间戳、revision 和 JSON 格式不参与摘要。
 */
export function computeScheduledTaskExecutionDigest(definition: ExecutableDefinition): string {
  const canonical = {
    id: definition.id,
    instruction: definition.instruction,
    schedule: canonicalSchedule(definition.schedule),
    resources: definition.resources.map((resource) =>
      resource.kind === 'workspace'
        ? { kind: 'workspace' as const }
        : { kind: resource.kind, path: resource.path },
    ),
    outputPolicy: {
      directory: definition.outputPolicy.directory,
      fileNameTemplate: definition.outputPolicy.fileNameTemplate,
      mode: definition.outputPolicy.mode,
    },
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

function canonicalSchedule(definition: ExecutableDefinition['schedule']): object {
  if (definition.kind === 'once') {
    return { kind: definition.kind, runAt: definition.runAt, timezone: definition.timezone }
  }
  if (definition.kind === 'weekly') {
    return {
      kind: definition.kind,
      time: definition.time,
      weekdays: [...definition.weekdays].sort((left, right) => left - right),
      timezone: definition.timezone,
    }
  }
  return { kind: definition.kind, time: definition.time, timezone: definition.timezone }
}
