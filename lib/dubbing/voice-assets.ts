import type { CreatorProfileConfig } from './creator-profile'

export function resolveDubbingPrimaryVoiceId(
  requestVoiceId: string | null | undefined,
  creatorProfile: CreatorProfileConfig | null | undefined,
): string {
  return requestVoiceId?.trim() || creatorProfile?.default_voice_id?.trim() || ''
}
