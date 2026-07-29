const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function compareStableVersions(left: string, right: string): number {
  if (!stableVersionPattern.test(left) || !stableVersionPattern.test(right)) {
    throw new Error('更新版本必须是稳定语义版本')
  }
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }
  return 0
}
