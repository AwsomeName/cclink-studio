declare module 'xhr2' {
  const XMLHttpRequest: typeof globalThis.XMLHttpRequest
  export default XMLHttpRequest
}

declare module 'ws' {
  const WebSocket: typeof globalThis.WebSocket
  export default WebSocket
}
