export interface LocalIdentity {
  localId: string
  deviceId: string
  deviceName: string
  createdAt: number
  updatedAt: number
  boundCloudUserId?: string | null
}

export interface IdentityApiContract {
  getLocalIdentity: () => Promise<LocalIdentity>
}
