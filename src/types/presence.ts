export type PresenceAction =
  | 'typing'
  | 'recording_audio'
  | 'uploading_file'
  | 'paused';

export type PresenceStatus = PresenceAction | 'online' | 'offline';

export interface PresenceUpdate {
  chatId: string;
  userId: string;
  action: PresenceAction;
  isTyping: boolean;
}
