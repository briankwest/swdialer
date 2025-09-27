import { useEffect, useState } from 'react';
import { signalWireService } from '../services/signalwire';
import { useCallStore } from './useCallStore';
import { callsAPI } from '../services/api';

export const useSignalWire = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setCallState, resetCallState } = useCallStore();

  useEffect(() => {
    const initializeSignalWire = async () => {
      try {
        await signalWireService.initialize(
          // onIncomingCall callback
          (remoteNumber) => {
            // Handle incoming call
            setCallState({
              isIncoming: true,
              remoteNumber,
              callDirection: 'inbound',
              callStatus: 'ringing',
            });
          },
          // onCallEnded callback - remote party hung up
          (wasIncoming: boolean) => {
            console.log('🔔 Remote party ended call - returning to idle, wasIncoming:', wasIncoming);

            // Get the current call direction before resetting
            const { callDirection } = useCallStore.getState();

            resetCallState();
            setError(null);  // Clear any errors

            // If it was an outbound call, trigger number clearing
            if (!wasIncoming && callDirection === 'outbound') {
              // We'll use a callback or event to clear the number
              window.dispatchEvent(new CustomEvent('clearDialedNumber'));
            }
          }
        );

        setIsInitialized(true);
        setCallState({ isConnected: true });
      } catch (err) {
        console.error('Failed to initialize SignalWire:', err);
        setError('Failed to connect to SignalWire');
        setCallState({ isConnected: false });
      }
    };

    initializeSignalWire();

    return () => {
      // Only cleanup on actual unmount, not on re-renders
      // The disconnect should only happen when the entire app unmounts
      console.log('⚠️ useSignalWire cleanup triggered - NOT disconnecting to preserve calls');
      // We'll let the service maintain its connection
      // signalWireService.disconnect() should only be called on app unmount
    };
  }, []);

  const makeCall = async (phoneNumber: string) => {
    try {
      console.log('📢 useSignalWire.makeCall() called with:', phoneNumber);
      setError(null);

      // Log call to backend
      console.log('📝 Logging call to backend...');
      const callData = await callsAPI.initiateCall(phoneNumber);
      console.log('✅ Backend logged call:', callData);

      // Make the actual call
      console.log('📞 Making actual call via SignalWire service...');
      const call = await signalWireService.makeCall(phoneNumber);
      console.log('✅ SignalWire service returned call object:', call);

      // Update the call status to connected (but don't change isInCall as it's already set)
      setCallState({
        callStatus: 'connected',
      });

      console.log('✅ Call state updated, call should be active');
      return callData;
    } catch (err: any) {
      console.error('❌ Failed to make call:', err);
      console.error('Error details:', {
        message: err?.message,
        stack: err?.stack,
        fullError: err
      });
      setError('Failed to make call: ' + (err?.message || 'Unknown error'));
      throw err;
    }
  };

  const endCall = async () => {
    try {
      console.log('🔴 Ending call...');
      await signalWireService.endCall();
      resetCallState();
      setError(null);  // Clear any errors
      console.log('✅ Call ended and state reset');
    } catch (err) {
      console.error('Failed to end call:', err);
      // Don't set error here as it causes blank screen
      // Just log the error and reset state
      // Reset state even if end call fails to return to dialer
      resetCallState();
      setError(null);  // Clear error to return to dialer
      console.log('⚠️ End call failed but returning to dialer');
    }
  };

  const answerCall = async () => {
    try {
      await signalWireService.answerCall();
      setCallState({
        isInCall: true,
        isIncoming: false,
        callStatus: 'connected',
      });
    } catch (err) {
      console.error('Failed to answer call:', err);
      setError('Failed to answer call');
    }
  };

  const rejectCall = async () => {
    try {
      console.log('🚫 Rejecting incoming call...');
      await signalWireService.rejectCall();
      resetCallState();
      setError(null);  // Clear any errors
      console.log('✅ Call rejected and state reset');
    } catch (err) {
      console.error('Failed to reject call:', err);
      // Don't set error here as it causes blank screen
      // Reset state even if reject fails to return to dialer
      resetCallState();
      setError(null);  // Clear error to return to dialer
      console.log('⚠️ Reject call failed but returning to dialer');
    }
  };

  const toggleMute = async () => {
    const { isMuted } = useCallStore.getState();
    const newMutedState = !isMuted;

    // Always update the UI state optimistically
    setCallState({ isMuted: newMutedState });

    try {
      await signalWireService.toggleMute(newMutedState);
    } catch (err) {
      // Log but don't show error to user since we handle it gracefully
      console.warn('Mute toggle warning:', err);
      // Don't set error state - the mute is handled via WebRTC directly
    }
  };

  const toggleSpeaker = async () => {
    const { isSpeakerOn } = useCallStore.getState();
    const newSpeakerState = !isSpeakerOn;

    try {
      await signalWireService.toggleSpeaker(newSpeakerState);
      setCallState({ isSpeakerOn: newSpeakerState });
    } catch (err) {
      console.error('Failed to toggle speaker:', err);
      setError('Failed to toggle speaker');
    }
  };

  const sendDTMF = async (digit: string) => {
    try {
      await signalWireService.sendDTMF(digit);
    } catch (err) {
      console.error('Failed to send DTMF:', err);
    }
  };

  return {
    isInitialized,
    error,
    makeCall,
    endCall,
    answerCall,
    rejectCall,
    toggleMute,
    toggleSpeaker,
    sendDTMF,
  };
};