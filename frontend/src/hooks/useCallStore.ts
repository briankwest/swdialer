import { create } from 'zustand';
import { CallState } from '../types';

interface CallStore extends CallState {
  setCallState: (state: Partial<CallState>) => void;
  resetCallState: () => void;
}

const initialState: CallState = {
  isConnected: false,  // Keep false - connection status shouldn't change
  isInCall: false,
  isIncoming: false,
  isMuted: false,
  isSpeakerOn: false,
  callDuration: 0,
  remoteNumber: '',
  callDirection: null,
  callStatus: 'idle',
};

export const useCallStore = create<CallStore>((set) => ({
  ...initialState,

  setCallState: (state) =>
    set((prev) => ({
      ...prev,
      ...state,
    })),

  resetCallState: () => {
    console.log('🔄 Resetting call state to initial state');
    // Keep the connection status but reset everything else
    set((state) => {
      const newState = {
        ...initialState,
        isConnected: state.isConnected,  // Preserve connection status
      };
      console.log('✅ State after reset:', newState);
      return newState;
    });
  },
}));