import React, { useState, useEffect } from 'react';
import DialPad from './DialPad';
import CallScreen from './CallScreen';
import IncomingCall from './IncomingCall';
import { useCallStore } from '../hooks/useCallStore';
import { useSignalWire } from '../hooks/useSignalWire';

const Dialer: React.FC = () => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isCallingInProgress, setIsCallingInProgress] = useState(false);
  const [lastDialedNumber, setLastDialedNumber] = useState(() => {
    // Load last dialed number from localStorage
    return localStorage.getItem('lastDialedNumber') || '';
  });

  const {
    isInCall,
    isIncoming,
    remoteNumber,
    isMuted,
    isSpeakerOn,
    setCallState,
    resetCallState,
  } = useCallStore();

  const { makeCall, endCall, answerCall, rejectCall, toggleMute, toggleSpeaker } = useSignalWire();

  // Save last dialed number to localStorage whenever it changes
  useEffect(() => {
    if (lastDialedNumber) {
      localStorage.setItem('lastDialedNumber', lastDialedNumber);
    }
  }, [lastDialedNumber]);

  const handleKeyInput = (key: string) => {
    if (phoneNumber.length < 20) {  // Increased to support international numbers
      setPhoneNumber((prev) => prev + key);
    }
  };

  const handleDelete = () => {
    setPhoneNumber((prev) => prev.slice(0, -1));
  };

  const handleClearAll = () => {
    setPhoneNumber('');
  };

  const handleCall = async () => {
    console.log('📢 handleCall() triggered');
    console.log('Current phoneNumber:', phoneNumber);
    console.log('Last dialed number:', lastDialedNumber);

    // Prevent multiple simultaneous calls
    if (isCallingInProgress) {
      console.log('⚠️ Call already in progress, ignoring duplicate request');
      return;
    }

    // If no number is entered but we have a last dialed number, just populate it
    if (!phoneNumber && lastDialedNumber) {
      console.log('🔄 Populating with last dialed number:', lastDialedNumber);
      setPhoneNumber(lastDialedNumber);
      return; // Don't dial, just populate
    }

    // If a number is entered, dial it
    if (phoneNumber && phoneNumber.length >= 7) {
      console.log('📞 Dialing:', phoneNumber);
      setLastDialedNumber(phoneNumber);
      setIsCallingInProgress(true);

      // Immediately set the call state to show the call screen
      // This happens BEFORE the actual call is initiated
      setCallState({
        isInCall: true,
        isIncoming: false,
        remoteNumber: phoneNumber,
        callDirection: 'outbound',
        callStatus: 'connecting',
        isMuted: false,
        isSpeakerOn: false,
      });

      try {
        await makeCall(phoneNumber);
        console.log('✅ makeCall completed');
      } catch (error) {
        console.error('❌ makeCall failed:', error);
        // Reset state if call fails
        resetCallState();
      } finally {
        // Reset the flag after call attempt completes or fails
        setIsCallingInProgress(false);
      }
    } else {
      console.log('⚠️ Number too short:', phoneNumber?.length || 0, 'digits');
    }
  };

  const handleEndCall = async () => {
    console.log('🔴 handleEndCall called');
    console.log('State before ending - isInCall:', isInCall, 'isIncoming:', isIncoming);

    await endCall();

    // Reset calling flag when call ends
    setIsCallingInProgress(false);

    // Clear the phone number for outgoing calls
    // (callDirection will be 'outbound' for calls we initiated)
    const { callDirection } = useCallStore.getState();
    if (callDirection === 'outbound') {
      setPhoneNumber('');
    }

    console.log('State after ending - isInCall:', useCallStore.getState().isInCall, 'isIncoming:', useCallStore.getState().isIncoming);
  };

  // Handle clearing number when outbound call ends (remote hangup)
  useEffect(() => {
    const handleClearNumber = () => {
      console.log('🗑️ Clearing dialed number after outbound call ended');
      setPhoneNumber('');
      setIsCallingInProgress(false); // Reset calling flag
    };

    window.addEventListener('clearDialedNumber', handleClearNumber);
    return () => window.removeEventListener('clearDialedNumber', handleClearNumber);
  }, []);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyboardInput = (e: KeyboardEvent) => {
      // Don't handle keyboard input if in a call
      if (isInCall || isIncoming) return;

      // Handle number keys (0-9)
      if (e.key >= '0' && e.key <= '9') {
        handleKeyInput(e.key);
      }
      // Handle special characters
      else if (e.key === '*' || e.key === '#' || e.key === '+') {
        handleKeyInput(e.key);
      }
      // Handle backspace/delete
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        handleDelete();
      }
      // Handle Enter to make a call (or redial if no number entered)
      else if (e.key === 'Enter') {
        handleCall();
      }
    };

    window.addEventListener('keydown', handleKeyboardInput);
    return () => window.removeEventListener('keydown', handleKeyboardInput);
  }, [phoneNumber, isInCall, isIncoming]);

  const formatPhoneNumber = (number: string): string => {
    // If number starts with +, keep it as international
    if (number.startsWith('+')) {
      return number;
    }

    // Remove all non-digit characters except + at the beginning
    const cleaned = number.replace(/[^\d+]/g, '').replace(/\+(?!^)/g, '');

    // For numbers with only digits
    const digitsOnly = cleaned.replace(/^\+/, '');

    if (digitsOnly.length === 10) {
      return `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
    } else if (digitsOnly.length === 11 && digitsOnly[0] === '1') {
      return `+1 (${digitsOnly.slice(1, 4)}) ${digitsOnly.slice(4, 7)}-${digitsOnly.slice(7)}`;
    }

    // Return as-is for other formats (including * and #)
    return number;
  };

  // Debug current state
  console.log('🎨 Dialer render - isInCall:', isInCall, 'isIncoming:', isIncoming);

  // Show incoming call modal
  if (isIncoming && !isInCall) {
    console.log('📱 Showing IncomingCall screen');
    return (
      <IncomingCall
        phoneNumber={remoteNumber}
        onAnswer={answerCall}
        onReject={rejectCall}
      />
    );
  }

  // Show active call screen
  if (isInCall) {
    console.log('📞 Showing CallScreen');
    return (
      <CallScreen
        phoneNumber={remoteNumber || phoneNumber}
        onEndCall={handleEndCall}
        isMuted={isMuted}
        isSpeakerOn={isSpeakerOn}
        onToggleMute={toggleMute}
        onToggleSpeaker={toggleSpeaker}
      />
    );
  }

  console.log('📱 Showing main Dialer');

  // Show dialer
  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Status Bar */}
      <div className="relative flex items-center justify-between px-6 py-2 text-sm">
        <span className="text-ios-green">●</span>
        <span className="absolute left-1/2 transform -translate-x-1/2 text-gray-400">SignalWire</span>
        <span className="text-gray-400">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Phone Number Display */}
        <div className="flex-1 flex items-center justify-center px-4 py-4 min-h-0">
          <div className="text-center">
            {phoneNumber ? (
              <div className="text-3xl sm:text-4xl font-light">
                {formatPhoneNumber(phoneNumber)}
              </div>
            ) : (
              <div className="text-xl sm:text-2xl text-gray-500">Enter a number</div>
            )}
          </div>
        </div>

        {/* Dial Pad Container */}
        <div className="pb-6 sm:pb-8">
          <DialPad
            onKeyPress={handleKeyInput}
            onCall={handleCall}
            onDelete={handleDelete}
            onClearAll={handleClearAll}
            hasNumber={phoneNumber.length > 0}
            disabled={isInCall || isCallingInProgress}
          />
        </div>
      </div>
    </div>
  );
};

export default Dialer;