export function shouldClearFileTreeSelectionOnBlur(
  relatedTarget: EventTarget | null,
  containsTarget: (target: EventTarget) => boolean,
): boolean {
  return relatedTarget === null || !containsTarget(relatedTarget)
}
