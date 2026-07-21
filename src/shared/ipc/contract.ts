export interface IpcInvokeDefinition<Args extends unknown[], Result> {
  readonly channel: string
  readonly args?: Args
  readonly result?: Result
}

export interface IpcInvokeContract<Args extends unknown[], Result> extends IpcInvokeDefinition<
  Args,
  Result
> {
  parseArgs(args: unknown[]): Args
  mapParseError?(error: unknown): Result | Promise<Result>
}

export function defineIpcCall<Args extends unknown[], Result>(
  channel: string,
): IpcInvokeDefinition<Args, Result> {
  return { channel }
}

export function bindIpcParser<Args extends unknown[], Result>(
  definition: IpcInvokeDefinition<Args, Result>,
  parseArgs: (args: unknown[]) => NoInfer<Args>,
  mapParseError?: (error: unknown) => NoInfer<Result> | Promise<NoInfer<Result>>,
): IpcInvokeContract<Args, Result> {
  return { ...definition, parseArgs, mapParseError }
}

export function bindNoArgsIpc<Result>(
  definition: IpcInvokeDefinition<[], Result>,
): IpcInvokeContract<[], Result> {
  return bindIpcParser(definition, (args) => {
    if (args.length !== 0) throw new Error(`IPC ${definition.channel} 不接受参数`)
    return []
  })
}

export function ipcArgs<Args extends unknown[]>(...args: Args): Args {
  return args
}

export function defineIpcInvoke<Args extends unknown[], Result>(
  channel: string,
  parseArgs: (args: unknown[]) => Args,
  mapParseError?: (error: unknown) => Result | Promise<Result>,
): IpcInvokeContract<Args, Result> {
  return bindIpcParser(defineIpcCall<Args, Result>(channel), parseArgs, mapParseError)
}

export function defineNoArgsIpc<Result>(channel: string): IpcInvokeContract<[], Result> {
  return defineIpcInvoke(channel, (args) => {
    if (args.length !== 0) throw new Error(`IPC ${channel} 不接受参数`)
    return []
  })
}
