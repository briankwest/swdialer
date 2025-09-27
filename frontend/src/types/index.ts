export interface CallState {
  isConnected: boolean;
  isInCall: boolean;
  isIncoming: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  callDuration: number;
  remoteNumber: string;
  callDirection: 'inbound' | 'outbound' | null;
  callStatus: 'idle' | 'connecting' | 'dialing' | 'ringing' | 'connected' | 'ended';
}

export interface TokenData {
  token: string;
  expires_at: string;
  expires_in: number;
  subscriber_id?: string;
  project_id: string;
  space_name: string;
}

export interface CallData {
  id: string;
  to: string;
  from: string;
  direction: 'inbound' | 'outbound';
  status: string;
  started_at: string;
  ended_at?: string;
  duration: number;
}

export interface DialPadKey {
  number: string;
  letters?: string;
  special?: boolean;
}